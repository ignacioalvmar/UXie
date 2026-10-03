import {
  AssessmentSchema,
  toYaml,
  type Assessment,
  type LearnerState,
  type TeachingGuide,
} from "@uxie/core";
import { LlmError, type LlmGateway, type PromptParts, type Usage } from "@uxie/llm";
import type { Logger } from "./ports";
import type { PromptLoader } from "./promptLoader";

/**
 * Stable part of the assessment prompt: rules + the objectives the state model judges against.
 * Version-stable, so it is cacheable (Haiku 4.5 caches prefixes ≥ 4096 tokens only).
 */
export function assessmentPrefix(prompts: PromptLoader, guide: TeachingGuide): string {
  const objectives = guide.objectives.map((o) => ({
    id: o.id,
    kind: o.kind,
    statement: o.statement,
    mastery_check: o.mastery_check,
    misconceptions: o.misconceptions,
  }));
  return `${prompts.render("assess.md")}\n\n<objectives>\n${toYaml(objectives)}</objectives>`;
}

export function buildAssessmentPrompt(
  prompts: PromptLoader,
  input: {
    guide: TeachingGuide;
    state: LearnerState;
    lastTutorMessage: string | null;
    studentText: string;
  },
): PromptParts {
  const { guide, state } = input;
  return {
    stablePrefix: assessmentPrefix(prompts, guide),
    dynamicSystem: prompts.render("assess_context.md", {
      mode: state.mode,
      active_objective: state.active_objective,
      objectives: guide.objectives.map((o) => ({
        id: o.id,
        status: state.objectives[o.id] ?? "not_started",
      })),
      misconceptions: state.misconceptions_seen,
      tutor_message: input.lastTutorMessage ?? "(none yet)",
    }),
    // Student text only ever in the user turn (NFR-8).
    messages: [{ role: "user", content: input.studentText }],
  };
}

export interface AssessmentOutcome {
  assessment: Assessment | null;
  usage: Usage | null;
  /** Error code when the assessment failed; the turn continues with the previous state (ADR-005). */
  failure: string | null;
}

/** Run the assessment call; never throws (a failed assessment must not block the reply). */
export async function runAssessment(
  deps: { llm: LlmGateway; prompts: PromptLoader; logger: Logger; timeoutMs: number },
  input: Parameters<typeof buildAssessmentPrompt>[1] & {
    conversationId: string;
    signal?: AbortSignal;
  },
): Promise<AssessmentOutcome> {
  try {
    const { value, usage } = await deps.llm.structured(
      buildAssessmentPrompt(deps.prompts, input),
      AssessmentSchema,
      {
        purpose: "assessment",
        timeoutMs: deps.timeoutMs,
        conversationId: input.conversationId,
        signal: input.signal,
      },
    );
    return { assessment: value, usage, failure: null };
  } catch (e) {
    const code = e instanceof LlmError ? e.code : "provider_error";
    deps.logger.warn(
      { conversationId: input.conversationId, errorCode: code },
      "assessment_failed",
    );
    return { assessment: null, usage: null, failure: code };
  }
}
