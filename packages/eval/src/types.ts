import type { Assessment, Mode } from "@uxie/core";
import type { LlmErrorCode, Purpose, UsageEvent } from "@uxie/llm";
import type { ProfileId } from "./profiles";
import type { JudgeVerdict } from "./judgeSchema";

/** One model call made by the system under test (tutor, assessment, summary). */
export interface CallSummary {
  purpose: Purpose;
  provider: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  costEur: number;
  latencyMs: number;
  ttftMs: number | null;
  ok: boolean;
  errorCode: LlmErrorCode | null;
  /** Student turn the call belongs to (0 = opening); null for calls outside a turn. */
  turn: number | null;
}

export function toCallSummary(e: UsageEvent, turn: number | null): CallSummary {
  return {
    purpose: e.purpose,
    provider: e.usage.provider,
    model: e.usage.model,
    inputTokens: e.usage.inputTokens,
    cachedInputTokens: e.usage.cachedInputTokens,
    cacheWriteInputTokens: e.usage.cacheWriteInputTokens,
    outputTokens: e.usage.outputTokens,
    costEur: e.usage.costEur,
    latencyMs: e.usage.latencyMs,
    ttftMs: e.usage.ttftMs ?? null,
    ok: e.ok,
    errorCode: e.errorCode ?? null,
    turn,
  };
}

export interface TurnRecord {
  /** 0 = the opening message (start event); 1.. = student messages. */
  turn: number;
  student: string | null;
  reply: string | null;
  /** TutorError code when the reply failed. */
  error: string | null;
  mode: Mode;
  /** `ask | hint:<i> | explain | check` (as stored in messages.help_level). */
  help: string;
  shortcutRequest: boolean;
  offTopic: boolean;
  assessment: Assessment | null;
  assessmentFailure: string | null;
  /** Valid citations kept in the reply. */
  citations: number;
  /** Citations to pages that do not exist (removed by the engine, FR-4.9). */
  citationsInvalid: number;
  ttftMs: number | null;
  latencyMs: number | null;
}

export interface AutoChecks {
  /** Replies over 200 words (PRD §13.3). */
  longReplies: number[];
  /** Replies with more than 2 question marks (soft). */
  manyQuestions: number[];
  citationsInvalid: number;
  /** Share of Understand-mode replies with a `[p.` citation; target ≥ 0.5. */
  understandCitationRate: number | null;
  /** ≥ 8-word overlaps with guide fields or base rules that are not in the paper. */
  leakedPhrases: { turn: number; phrase: string }[];
  /** Confused profile only. */
  helpSequence: HelpSequenceCheck | null;
  /** German profile only: share of replies (after the first student message) detected as German. */
  germanReplyRate: number | null;
}

export interface HelpSequenceCheck {
  /** Help levels of the replies to student messages, in order. */
  sequence: string[];
  /** Student turn whose reply first used `explain`, or null. */
  explainTurn: number | null;
  /** Levels never went down before the first `explain`. */
  escalates: boolean;
  /** `explain` reached by STUCK_THRESHOLD student turns. */
  explainedInTime: boolean;
  /** The explain reply asks a question, and the next reply (if any) uses `check`. */
  checkFollows: boolean;
  pass: boolean;
}

export interface RunRecord {
  provider: string;
  profile: ProfileId;
  run: number;
  fixture: string;
  turns: TurnRecord[];
  finalState: {
    objectives: Record<string, string>;
    objectiveKinds: Record<string, string>;
    misconceptions: { text: string; resolved: boolean }[];
  };
  /** Calls of the system under test. */
  calls: CallSummary[];
  /** Simulated student + judge cost (not part of the product's cost). */
  harnessCostEur: number;
  checks: AutoChecks;
  judge: JudgeVerdict | null;
  judgeError: string | null;
  pass: boolean;
  failReasons: string[];
}
