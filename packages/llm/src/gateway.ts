import {
  APICallError,
  NoObjectGeneratedError,
  Output,
  generateText,
  streamText,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";
import { acceptsTemperature } from "./capabilities";
import { costEur } from "./cost";
import { anthropicAdapter } from "./providers/anthropic";
import { googleAdapter } from "./providers/google";
import { mockAdapter, type MockResponder } from "./providers/mock";
import { openaiCompatibleAdapter } from "./providers/openaiCompatible";
import type { ProviderAdapter } from "./providers/types";
import {
  LlmError,
  type LlmEnv,
  type LlmGateway,
  type LlmStream,
  type PromptParts,
  type Purpose,
  type StructuredOptions,
  type Usage,
  type UsageEvent,
} from "./types";

export interface GatewayOptions {
  /** Receives every call, successful or not; adapters wire it to `llm_calls` (PRD §8.3). */
  onUsage?: (event: UsageEvent) => void;
  /** Scripted responses when LLM_PROVIDER=mock. */
  mockResponder?: MockResponder;
  /** Custom fetch for HTTP providers (tests inspect request bodies with it). */
  fetch?: typeof globalThis.fetch;
  /** Replace the adapter entirely (tests). */
  adapter?: ProviderAdapter;
  now?: () => number;
}

/** Output budget per purpose; tutor replies get LLM_MAX_OUTPUT_TOKENS (headroom for thinking). */
const MAX_TOKENS: Record<Exclude<Purpose, "tutor">, number> = {
  assessment: 1024,
  summary: 1024,
  guide_draft: 16_000,
  report: 4000,
  eval_student: 1024,
  eval_judge: 4000,
};

/** One retry with backoff, only before the first token (FR-9.3); the AI SDK retries 429/5xx. */
const MAX_RETRIES = 1;

function adapterFor(env: LlmEnv, o: GatewayOptions): ProviderAdapter {
  if (o.adapter) return o.adapter;
  switch (env.LLM_PROVIDER) {
    case "anthropic":
      return anthropicAdapter(env, o.fetch);
    case "openai_compatible":
      return openaiCompatibleAdapter(env, o.fetch);
    case "google":
      return googleAdapter(env, o.fetch);
    case "mock":
      return mockAdapter(o.mockResponder);
  }
}

/** Map any thrown value to an LlmError with a stable code. */
export function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  const err = e as { name?: string; message?: string };
  if (err?.name === "TimeoutError")
    return new LlmError("timeout", "The model did not answer in time", { cause: e });
  if (err?.name === "AbortError")
    return new LlmError("aborted", "The request was aborted", { cause: e });
  const api = APICallError.isInstance(e)
    ? e
    : APICallError.isInstance((e as { lastError?: unknown })?.lastError)
      ? (e as { lastError: APICallError }).lastError
      : undefined;
  if (api?.statusCode === 429)
    return new LlmError("rate_limited", "The model provider is rate limiting", { cause: e });
  if (api?.statusCode !== undefined && api.statusCode >= 500) {
    return new LlmError("provider_unavailable", "The model provider is unavailable", { cause: e });
  }
  return new LlmError("provider_error", err?.message ?? "Model call failed", { cause: e });
}

/** Push/pull channel: lets the gateway drain the provider stream even if nobody reads it. */
class Channel<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;
  private failure: unknown;
  private failWaiters: ((e: unknown) => void)[] = [];

  push(item: T) {
    const w = this.waiters.shift();
    if (w) {
      this.failWaiters.shift();
      w({ value: item, done: false });
    } else this.items.push(item);
  }
  close(error?: unknown) {
    this.closed = true;
    this.failure = error;
    for (const w of this.waiters) w({ value: undefined, done: true });
    for (const f of this.failWaiters) if (error !== undefined) f(error);
    this.waiters = [];
    this.failWaiters = [];
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.closed) {
          return this.failure !== undefined
            ? Promise.reject(this.failure)
            : Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve, reject) => {
          this.waiters.push(resolve);
          this.failWaiters.push(reject);
        });
      },
    };
  }
}

/** Extract a JSON value from model text that may be wrapped in a code fence or prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start < 0 || end < start) throw new SyntaxError("No JSON object found in the output");
  return JSON.parse(body.slice(start, end + 1));
}

export function createGateway(env: LlmEnv, options: GatewayOptions = {}): LlmGateway {
  const adapter = adapterFor(env, options);
  const now = options.now ?? (() => performance.now());
  const stateModel = env.LLM_STATE_MODEL ?? env.LLM_TUTOR_MODEL;
  const judgeModel = env.LLM_JUDGE_MODEL ?? env.LLM_TUTOR_MODEL;

  const modelFor = (purpose: Purpose): string => {
    switch (purpose) {
      case "assessment":
      case "summary":
      case "report":
        return stateModel;
      case "eval_judge":
        return judgeModel;
      default:
        return env.LLM_TUTOR_MODEL;
    }
  };

  const toUsage = (
    model: string,
    u: LanguageModelUsage | undefined,
    latencyMs: number,
    ttftMs?: number,
  ): Usage => {
    const input = u?.inputTokens ?? 0;
    const cacheRead = u?.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWrite = u?.inputTokenDetails?.cacheWriteTokens ?? 0;
    const noCache =
      u?.inputTokenDetails?.noCacheTokens ?? Math.max(0, input - cacheRead - cacheWrite);
    const output = u?.outputTokens ?? 0;
    return {
      inputTokens: input,
      outputTokens: output,
      cachedInputTokens: cacheRead,
      cacheWriteInputTokens: cacheWrite,
      latencyMs: Math.round(latencyMs),
      ...(ttftMs === undefined ? {} : { ttftMs: Math.round(ttftMs) }),
      costEur: costEur(
        model,
        { noCache, cacheRead, cacheWrite, output },
        env.LLM_PRICES_JSON,
        env.LLM_CACHE_TTL,
        env.USD_TO_EUR,
      ),
      model,
      provider: adapter.name,
    };
  };

  const report = (event: UsageEvent) => {
    try {
      options.onUsage?.(event);
    } catch {
      // Usage reporting must never break a student's turn.
    }
  };

  const temperatureFor = (model: string, requested?: number) => {
    const t = requested ?? env.LLM_TEMPERATURE;
    return t !== undefined && acceptsTemperature(adapter.name, model) ? { temperature: t } : {};
  };

  const signalFor = (timeoutMs: number, signal?: AbortSignal) =>
    signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

  return {
    provider: adapter.name,
    modelFor,

    stream(p, o): LlmStream {
      const model = o.model ?? modelFor(o.purpose);
      const started = now();
      const channel = new Channel<string>();
      const result = streamText({
        model: adapter.model(model, o.purpose),
        instructions: adapter.instructions(p),
        messages: p.messages,
        maxOutputTokens:
          o.maxTokens ??
          (o.purpose === "tutor" ? env.LLM_MAX_OUTPUT_TOKENS : MAX_TOKENS[o.purpose]),
        ...temperatureFor(model, o.temperature),
        providerOptions: adapter.providerOptions(model, o.purpose),
        maxRetries: MAX_RETRIES,
        abortSignal: signalFor(env.LLM_TIMEOUT_MS, o.signal),
        onError: () => {}, // errors are surfaced through the stream parts below
      });

      const done = (async () => {
        let text = "";
        let ttft: number | undefined;
        let usage: LanguageModelUsage | undefined;
        let finishReason: string | undefined;
        let failure: unknown;
        try {
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              ttft ??= now() - started;
              text += part.text;
              channel.push(part.text);
            } else if (part.type === "finish") {
              usage = part.totalUsage;
              finishReason = part.finishReason;
            } else if (part.type === "error") {
              failure ??= part.error;
            } else if (part.type === "abort") {
              failure ??= o.signal?.aborted
                ? o.signal.reason
                : new DOMException("timeout", "TimeoutError");
            }
          }
        } catch (e) {
          failure ??= e;
        }
        if (failure === undefined && finishReason === "content-filter") {
          failure = new LlmError("provider_refusal", "The model declined to answer");
        }
        const u = toUsage(model, usage, now() - started, ttft);
        if (failure !== undefined) {
          const error = toLlmError(failure);
          report({
            purpose: o.purpose,
            usage: u,
            ok: false,
            errorCode: error.code,
            conversationId: o.conversationId,
            meta: {},
          });
          channel.close(error);
          throw error;
        }
        const meta = o.annotate?.(text) ?? {};
        report({ purpose: o.purpose, usage: u, ok: true, conversationId: o.conversationId, meta });
        channel.close();
        return { text, usage: u };
      })();
      done.catch(() => {}); // callers may read only the text stream; the rejection still reaches awaiters

      return { textStream: channel, done };
    },

    async structured<T>(p: PromptParts, schema: z.ZodType<T>, o: StructuredOptions) {
      const model = o.model ?? modelFor(o.purpose);
      const totals: Usage[] = [];
      const timeoutMs = o.timeoutMs ?? env.LLM_TIMEOUT_MS;
      const jsonPrompt = adapter.structuredMode === "json_prompt";
      const parts: PromptParts = jsonPrompt
        ? {
            ...p,
            dynamicSystem: [
              p.dynamicSystem,
              `Respond with JSON only, no prose and no code fence, matching this JSON schema:\n${JSON.stringify(z.toJSONSchema(schema))}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          }
        : p;

      const attempt = async (messages: PromptParts["messages"]) => {
        const started = now();
        try {
          const res = await generateText({
            model: adapter.model(model, o.purpose),
            instructions: adapter.instructions(parts),
            messages,
            maxOutputTokens:
              o.maxTokens ??
              (o.purpose === "tutor" ? env.LLM_MAX_OUTPUT_TOKENS : MAX_TOKENS[o.purpose]),
            ...temperatureFor(model),
            providerOptions: adapter.providerOptions(model, o.purpose),
            maxRetries: MAX_RETRIES,
            abortSignal: signalFor(timeoutMs, o.signal),
            ...(jsonPrompt ? {} : { output: Output.object({ schema }) }),
          });
          const usage = toUsage(model, res.totalUsage, now() - started);
          totals.push(usage);
          if (res.finishReason === "content-filter") {
            const error = new LlmError("provider_refusal", "The model declined to answer");
            report({
              purpose: o.purpose,
              usage,
              ok: false,
              errorCode: error.code,
              conversationId: o.conversationId,
              meta: {},
            });
            throw error;
          }
          report({
            purpose: o.purpose,
            usage,
            ok: true,
            conversationId: o.conversationId,
            meta: {},
          });
          if (jsonPrompt) {
            const parsed = schema.safeParse(safeJson(res.text));
            return parsed.success
              ? { ok: true as const, value: parsed.data }
              : { ok: false as const, text: res.text, problem: z.prettifyError(parsed.error) };
          }
          return { ok: true as const, value: res.output as T };
        } catch (e) {
          if (NoObjectGeneratedError.isInstance(e)) {
            const usage = toUsage(
              model,
              e.usage as LanguageModelUsage | undefined,
              now() - started,
            );
            totals.push(usage);
            if (e.finishReason === "content-filter") {
              report({
                purpose: o.purpose,
                usage,
                ok: false,
                errorCode: "provider_refusal",
                conversationId: o.conversationId,
                meta: {},
              });
              throw new LlmError("provider_refusal", "The model declined to answer", { cause: e });
            }
            report({
              purpose: o.purpose,
              usage,
              ok: false,
              errorCode: "invalid_output",
              conversationId: o.conversationId,
              meta: {},
            });
            const cause = e.cause as { message?: string } | undefined;
            return { ok: false as const, text: e.text ?? "", problem: cause?.message ?? e.message };
          }
          if (e instanceof LlmError) throw e;
          const error = toLlmError(e);
          report({
            purpose: o.purpose,
            usage: toUsage(model, undefined, now() - started),
            ok: false,
            errorCode: error.code,
            conversationId: o.conversationId,
            meta: {},
          });
          throw error;
        }
      };

      let r = await attempt(parts.messages);
      if (!r.ok) {
        // One repair retry with the validation error appended (PRD §8.3).
        r = await attempt([
          ...parts.messages,
          { role: "assistant", content: r.text || "(no output)" },
          {
            role: "user",
            content: `Your previous output was invalid:\n${r.problem}\nReturn only corrected JSON that matches the schema.`,
          },
        ]);
      }
      if (!r.ok)
        throw new LlmError("invalid_output", `Structured output stayed invalid: ${r.problem}`);
      const usage = totals.reduce<Usage>(
        (a, u) => ({
          ...u,
          inputTokens: a.inputTokens + u.inputTokens,
          outputTokens: a.outputTokens + u.outputTokens,
          cachedInputTokens: a.cachedInputTokens + u.cachedInputTokens,
          cacheWriteInputTokens: a.cacheWriteInputTokens + u.cacheWriteInputTokens,
          latencyMs: a.latencyMs + u.latencyMs,
          costEur: a.costEur + u.costEur,
        }),
        {
          ...totals[0]!,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          latencyMs: 0,
          costEur: 0,
        },
      );
      return { value: r.value, usage };
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return extractJson(text);
  } catch {
    return undefined;
  }
}
