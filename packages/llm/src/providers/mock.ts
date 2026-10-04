import { MockLanguageModelV4 } from "ai/test";
import { estimateTokens } from "@uxie/core";
import type { PromptParts, Purpose } from "../types";
import type { ProviderAdapter } from "./types";

type CallOptions = Parameters<MockLanguageModelV4["doStream"]>[0];
type StreamPart = CallOptions extends unknown
  ? Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P>
    ? P
    : never
  : never;

/** What a scripted mock response sees. */
export interface MockCall {
  purpose: Purpose;
  modelId: string;
  /** All system content joined, in order. */
  system: string;
  /** System blocks as sent: [stable prefix, dynamic part]. */
  systemBlocks: string[];
  messages: { role: "user" | "assistant"; content: string }[];
  /** True when structured (JSON) output was requested. */
  json: boolean;
  /** 0-based index of this call within the adapter's lifetime. */
  index: number;
}

export interface MockResponse {
  text: string;
  /** `content-filter` simulates a provider refusal. */
  finishReason?: "stop" | "length" | "content-filter";
  /** Throw this instead of answering (e.g. an APICallError or a TimeoutError). */
  error?: unknown;
  /** Wait before the first token; honours the abort signal. */
  delayMs?: number;
}

export type MockResponder = (call: MockCall) => string | MockResponse;

/**
 * A placeholder teaching guide that passes `TeachingGuideSchema` for any paper (refs to page 1),
 * so `pnpm uxie ingest --local` works offline. Its content is generic, not drafted from the paper.
 */
export function mockGuideDraft(system: string) {
  const title = /<paper title="([^"]*)"/.exec(system)?.[1] ?? "Mock paper";
  const objective = (id: string, kind: "understanding" | "application", statement: string) => ({
    id,
    kind,
    statement,
    refs: [{ page: 1, label: "Abstract" }],
    key_concepts: ["main claim"],
    question_ladder: [
      "In your own words, what is the paper's main claim?",
      "What evidence does the paper give for it?",
    ],
    hints: [
      "Start with the abstract on page 1.",
      "The abstract states the claim and the evidence.",
    ],
    misconceptions: [],
    mastery_check: "The student states the claim in their own words and names the evidence.",
  });
  return {
    title: `${title} (mock draft)`,
    summary_for_tutor: "Mock draft produced by LLM_PROVIDER=mock. Replace it before approving.",
    starter_questions: ["What problem does this paper address?", "What did the authors find?"],
    objectives: [
      objective("U1", "understanding", "State the paper's main claim in your own words."),
      objective("U2", "understanding", "Describe the evidence behind the main claim."),
      objective("A1", "application", "Use the main claim to justify one UX decision."),
    ],
    ux_scenarios: ["A product team deciding how to apply the paper's finding."],
    discussion_prompts: [],
    build_prompts: [],
    evidence_limits: [],
  };
}

/** Calls seen per student text, for `[mock:fail]` (fails until retried by the student). */
const failedTexts = new Map<string, number>();

/**
 * Manual-test switches in the student's text, for tutor replies with the default mock only
 * (docs/manual-tests.md, M6): `[mock:fail]` fails the first reply to that text (a plain error,
 * not retried by the SDK), so the student's Retry succeeds; `[mock:slow]` waits 6 s before the first token.
 */
function devDirective(call: MockCall): MockResponse | null {
  if (call.purpose !== "tutor") return null;
  const last = call.messages.at(-1)?.content ?? "";
  if (last.includes("[mock:fail]")) {
    const seen = failedTexts.get(last) ?? 0;
    failedTexts.set(last, seen + 1);
    if (seen === 0)
      return { text: "", error: Object.assign(new Error("mock failure"), { name: "MockFailure" }) };
  }
  if (last.includes("[mock:slow]"))
    return {
      text: "(mock UXie) Sorry for the wait. The paper covers this on page 2 [p. 2]. What do you notice there?",
      delayMs: 6000,
    };
  return null;
}

/** Default scripted behaviour: valid assessments, short Socratic replies naming the help level. */
export const defaultMockResponder: MockResponder = (call) => {
  if (call.purpose === "assessment") {
    const last = call.messages.at(-1)?.content ?? "";
    return JSON.stringify({
      intent: /\?\s*$/.test(last) ? "question" : "answer",
      answer_quality: /\?\s*$/.test(last) ? "none" : "partial",
      objective_updates: [],
      misconception: null,
      misconception_resolved: null,
      language: "en",
    });
  }
  if (call.purpose === "summary")
    return "The student has been discussing the paper's main concepts.";
  if (call.purpose === "guide_draft") return JSON.stringify(mockGuideDraft(call.system));
  if (call.json) return "{}";
  const directive = devDirective(call);
  if (directive) return directive;
  const help = /HELP DIRECTIVE: (\w+)/.exec(call.system)?.[1]?.toLowerCase() ?? "ask";
  return `(mock UXie, ${help}) That's a thoughtful start. The paper discusses this on page 1 [p. 1]. What do you think the authors mean?`;
};

function toMockCall(
  options: CallOptions,
  purpose: Purpose,
  modelId: string,
  index: number,
): MockCall {
  const system: string[] = [];
  const messages: MockCall["messages"] = [];
  for (const m of options.prompt) {
    if (m.role === "system") system.push(m.content);
    else if (m.role === "user" || m.role === "assistant") {
      const text = m.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      messages.push({ role: m.role, content: text });
    }
  }
  return {
    purpose,
    modelId,
    system: system.join("\n\n"),
    systemBlocks: system,
    messages,
    json: options.responseFormat?.type === "json",
    index,
  };
}

async function wait(ms: number, signal?: AbortSignal) {
  if (!ms) return;
  if (signal?.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });
}

/**
 * Deterministic provider for tests and offline development (LLM_PROVIDER=mock), built on the
 * AI SDK mock model so the real gateway code paths run. Simulates prompt caching: the first call
 * with a given first system block reports a cache write, later calls a cache read.
 */
export function mockAdapter(responder: MockResponder = defaultMockResponder): ProviderAdapter {
  const seenPrefixes = new Set<string>();
  let calls = 0;

  const respond = async (options: CallOptions, purpose: Purpose, modelId: string) => {
    const call = toMockCall(options, purpose, modelId, calls++);
    const raw = responder(call);
    const res: MockResponse = typeof raw === "string" ? { text: raw } : raw;
    await wait(res.delayMs ?? 0, options.abortSignal);
    if (res.error !== undefined) throw res.error;

    const firstSystem = options.prompt.find((m) => m.role === "system")?.content ?? "";
    const prefixTokens = estimateTokens(firstSystem);
    const cached = seenPrefixes.has(firstSystem);
    seenPrefixes.add(firstSystem);
    const total = estimateTokens(call.system + call.messages.map((m) => m.content).join(""));
    const usage = {
      inputTokens: {
        total,
        noCache: total - prefixTokens,
        cacheRead: cached ? prefixTokens : 0,
        cacheWrite: cached ? 0 : prefixTokens,
      },
      outputTokens: {
        total: estimateTokens(res.text),
        text: estimateTokens(res.text),
        reasoning: 0,
      },
    };
    const finishReason = {
      unified: res.finishReason ?? "stop",
      raw: res.finishReason ?? "end_turn",
    } as const;
    return { res, usage, finishReason };
  };

  return {
    name: "mock",
    structuredMode: "native",
    instructions: (p: PromptParts) => {
      const blocks = [{ role: "system" as const, content: p.stablePrefix }];
      if (p.dynamicSystem) blocks.push({ role: "system" as const, content: p.dynamicSystem });
      return blocks;
    },
    providerOptions: () => undefined,
    model: (modelId, purpose) =>
      new MockLanguageModelV4({
        provider: "mock",
        modelId,
        doGenerate: async (options) => {
          const { res, usage, finishReason } = await respond(options, purpose, modelId);
          return { content: [{ type: "text", text: res.text }], finishReason, usage, warnings: [] };
        },
        doStream: async (options) => {
          const { res, usage, finishReason } = await respond(options, purpose, modelId);
          const chunks = res.text.match(/\S+\s*|\s+/g) ?? [];
          const parts: StreamPart[] = [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            ...chunks.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
            { type: "text-end", id: "t" },
            { type: "finish", finishReason, usage },
          ];
          return {
            stream: new ReadableStream<StreamPart>({
              start(controller) {
                for (const p of parts) controller.enqueue(p);
                controller.close();
              },
            }),
          };
        },
      }),
  };
}
