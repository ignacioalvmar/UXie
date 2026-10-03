import {
  APICallError,
  NoObjectGeneratedError,
  Output,
  generateText,
  streamText,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";
import type { LlmProvider, LlmSettings, RoleModel } from "@uxie/core";
import { acceptsTemperature } from "./capabilities";
import { costEur } from "./cost";
import { anthropicAdapter } from "./providers/anthropic";
import { googleAdapter } from "./providers/google";
import { mockAdapter, type MockResponder } from "./providers/mock";
import { openaiAdapter } from "./providers/openai";
import { openaiCompatibleAdapter } from "./providers/openaiCompatible";
import type { ProviderAdapter } from "./providers/types";
import {
  LlmError,
  type LlmGateway,
  type LlmStream,
  type PromptParts,
  PURPOSE_ROLE,
  type Purpose,
  type StructuredOptions,
  type Usage,
  type UsageEvent,
} from "./types";

export interface GatewayOptions {
  /** Receives every call, successful or not; adapters wire it to `llm_calls` (PRD §8.3). */
  onUsage?: (event: UsageEvent) => void;
  /** Scripted responses for roles served by the mock provider. */
  mockResponder?: MockResponder;
  /** Custom fetch for HTTP providers (tests inspect request bodies with it). */
  fetch?: typeof globalThis.fetch;
  /** Replace adapters per provider (tests). */
  adapters?: Partial<Record<LlmProvider, ProviderAdapter>>;
  now?: () => number;
}

/** Output budget per purpose; tutor replies get settings.maxOutputTokens (headroom for thinking). */
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

function createAdapter(
  provider: LlmProvider,
  settings: LlmSettings,
  o: GatewayOptions,
): ProviderAdapter {
  const override = o.adapters?.[provider];
  if (override) return override;
  const cred = settings.credentials[provider];
  switch (provider) {
    case "anthropic":
      return anthropicAdapter(cred, settings, o.fetch);
    case "openai":
      return openaiAdapter(cred, settings, o.fetch);
    case "google":
      return googleAdapter(cred, settings, o.fetch);
    case "openai_compatible":
      return openaiCompatibleAdapter(cred, o.fetch);
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

/**
 * Gateway over the providers named in `settings` (PRD §8.3, FR-9.6). Each purpose is served by
 * its role's provider and model; adapters are created on first use, so a provider without
 * credentials only fails if a role actually uses it.
 */
export function createGateway(settings: LlmSettings, options: GatewayOptions = {}): LlmGateway {
  const now = options.now ?? (() => performance.now());
  const adapters = new Map<LlmProvider, ProviderAdapter>();
  const adapterOf = (provider: LlmProvider) => {
    let a = adapters.get(provider);
    if (!a) {
      a = createAdapter(provider, settings, options);
      adapters.set(provider, a);
    }
    return a;
  };

  const modelFor = (purpose: Purpose): RoleModel => settings.roles[PURPOSE_ROLE[purpose]];
  const route = (purpose: Purpose, modelOverride?: string) => {
    const role = modelFor(purpose);
    return { adapter: adapterOf(role.provider), model: modelOverride ?? role.model };
  };
  const maxTokensFor = (purpose: Purpose, requested?: number) =>
    requested ?? (purpose === "tutor" ? settings.maxOutputTokens : MAX_TOKENS[purpose]);

  const toUsage = (
    provider: LlmProvider,
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
        settings.prices,
        settings.cacheTtl,
        settings.usdToEur,
      ),
      model,
      provider,
    };
  };

  const report = (event: UsageEvent) => {
    try {
      options.onUsage?.(event);
    } catch {
      // Usage reporting must never break a student's turn.
    }
  };

  const temperatureFor = (provider: LlmProvider, model: string, requested?: number) => {
    const t = requested ?? settings.temperature;
    return t !== undefined && acceptsTemperature(provider, model) ? { temperature: t } : {};
  };

  const signalFor = (timeoutMs: number, signal?: AbortSignal) =>
    signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

  return {
    modelFor,

    stream(p, o): LlmStream {
      const { adapter, model } = route(o.purpose, o.model);
      const started = now();
      const channel = new Channel<string>();
      const result = streamText({
        model: adapter.model(model, o.purpose),
        instructions: adapter.instructions(p),
        messages: p.messages,
        maxOutputTokens: maxTokensFor(o.purpose, o.maxTokens),
        ...temperatureFor(adapter.name, model, o.temperature),
        providerOptions: adapter.providerOptions(model, o.purpose, p),
        maxRetries: MAX_RETRIES,
        abortSignal: signalFor(settings.timeoutMs, o.signal),
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
        const u = toUsage(adapter.name, model, usage, now() - started, ttft);
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
      const { adapter, model } = route(o.purpose, o.model);
      const totals: Usage[] = [];
      const timeoutMs = o.timeoutMs ?? settings.timeoutMs;
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
            maxOutputTokens: maxTokensFor(o.purpose, o.maxTokens),
            ...temperatureFor(adapter.name, model),
            providerOptions: adapter.providerOptions(model, o.purpose, parts),
            maxRetries: MAX_RETRIES,
            abortSignal: signalFor(timeoutMs, o.signal),
            ...(jsonPrompt ? {} : { output: Output.object({ schema }) }),
          });
          const usage = toUsage(adapter.name, model, res.totalUsage, now() - started);
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
              adapter.name,
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
            usage: toUsage(adapter.name, model, undefined, now() - started),
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
