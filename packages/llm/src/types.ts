import type { LlmRole, RoleModel } from "@uxie/core";
import type { z } from "zod";

/** Why a model is called; selects the default model and limits (PRD §8.3). */
export type Purpose =
  "tutor" | "assessment" | "summary" | "guide_draft" | "report" | "eval_student" | "eval_judge";

export interface PromptParts {
  /** Base rules + paper + guide; byte-identical across turns of a conversation (cached). */
  stablePrefix: string;
  /** Mode, state, help directive, project, language, event annotation. */
  dynamicSystem: string;
  /** History + current student message. Student text only ever appears here. */
  messages: { role: "user" | "assistant"; content: string }[];
}

export interface Usage {
  /** All input tokens, including cache reads and writes. */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  latencyMs: number;
  ttftMs?: number;
  costEur: number;
  model: string;
  provider: string;
}

export interface UsageEvent {
  purpose: Purpose;
  usage: Usage;
  ok: boolean;
  errorCode?: LlmErrorCode;
  conversationId?: string;
  /** Extra facts for `llm_calls.meta`, e.g. `{ citation_invalid: 1 }`. */
  meta: Record<string, unknown>;
}

export interface StreamOptions {
  purpose: Purpose;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  conversationId?: string;
  /** Called with the final text before usage is reported; its result becomes `UsageEvent.meta`. */
  annotate?: (text: string) => Record<string, unknown>;
}

export interface StructuredOptions {
  purpose: Purpose;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  conversationId?: string;
}

export interface LlmStream {
  textStream: AsyncIterable<string>;
  done: Promise<{ text: string; usage: Usage }>;
}

/** Which settings role serves each purpose (PRD §8.3). */
export const PURPOSE_ROLE: Record<Purpose, LlmRole> = {
  tutor: "tutor",
  guide_draft: "tutor",
  eval_student: "tutor",
  assessment: "state",
  summary: "state",
  report: "state",
  eval_judge: "judge",
};

export interface LlmGateway {
  /** Provider and model that serve a purpose. */
  modelFor(purpose: Purpose): RoleModel;
  stream(p: PromptParts, o: StreamOptions): LlmStream;
  /** Validated structured output; one repair retry with the validation error appended. */
  structured<T>(
    p: PromptParts,
    schema: z.ZodType<T>,
    o: StructuredOptions,
  ): Promise<{ value: T; usage: Usage }>;
}

export type LlmErrorCode =
  | "provider_refusal"
  | "timeout"
  | "aborted"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_output"
  | "provider_error";

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmError";
  }

  /** Whether retrying the same request later could succeed. Refusals never are. */
  get retryable(): boolean {
    return (
      this.code === "timeout" ||
      this.code === "rate_limited" ||
      this.code === "provider_unavailable"
    );
  }
}
