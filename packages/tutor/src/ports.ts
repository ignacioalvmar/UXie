import type { Citation, LearnerState, Mode, TeachingGuide } from "@uxie/core";
import type { LlmErrorCode, Purpose } from "@uxie/llm";

/**
 * Storage ports (PRD §8.7). packages/db implements them for Supabase; ./testing implements them
 * in memory for the CLI, evals and tests. The engine never sees a database client.
 */

export interface PaperForTutor {
  versionId: string;
  paperId: string;
  title: string;
  pageCount: number;
  pages: { n: number; text: string }[];
  guide: TeachingGuide;
  tokenEstimate: number;
}

export interface PaperRepo {
  getVersionForTutor(versionId: string): Promise<PaperForTutor>;
  /** Page numbers ranked by relevance (Postgres FTS in production). */
  searchPages(versionId: string, query: string, limit: number): Promise<number[]>;
}

export type MessageRole = "student" | "tutor" | "event";
export type MessageStatus = "complete" | "streaming" | "failed";
/** Events a student can trigger without typing; stored as `role = 'event'` messages. */
export type StudentEvent = "start" | "stuck" | "mode_switch";

export interface ConversationRecord {
  id: string;
  studentId: string;
  paperVersionId: string;
  mode: Mode;
  state: LearnerState;
  status: "active" | "reset" | "closed";
  isTest: boolean;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  event: StudentEvent | null;
  mode: Mode | null;
  helpLevel: string | null;
  clientMessageId: string | null;
  replyTo: string | null;
  citations: Citation[];
  createdAt: Date;
}

export interface NewStudentMessage {
  conversationId: string;
  clientMessageId: string;
  /** `student` for typed text; `event` for button actions (content is the UI label). */
  role: "student" | "event";
  event: StudentEvent | null;
  content: string;
  mode: Mode;
}

export interface NewTutorMessage {
  conversationId: string;
  replyTo: string;
  mode: Mode;
  helpLevel: string;
}

export interface GenerationInfo {
  max_tokens: number;
  temperature: number | null;
  context_strategy: "full" | "retrieval";
  pages_included: number[] | "all";
}

export interface TutorMessageCompletion {
  content: string;
  citations: Citation[];
  provider: string;
  model: string;
  promptVersion: string;
  generation: GenerationInfo;
}

export interface ConversationRepo {
  get(conversationId: string): Promise<ConversationRecord>;
  /** The last `limit` messages in chronological order. */
  recentMessages(conversationId: string, limit: number): Promise<MessageRecord[]>;
  /** All messages after `afterMessageId` (from the start when null), chronological. */
  messagesAfter(conversationId: string, afterMessageId: string | null): Promise<MessageRecord[]>;
  /** Idempotent on (conversationId, clientMessageId). */
  insertStudentMessage(m: NewStudentMessage): Promise<{ id: string; existed: boolean }>;
  /** The newest tutor message replying to a student message, if any. */
  findReply(studentMessageId: string): Promise<MessageRecord | null>;
  /** Inserted with status 'streaming'. */
  insertTutorMessage(m: NewTutorMessage): Promise<{ id: string }>;
  completeTutorMessage(id: string, patch: TutorMessageCompletion): Promise<void>;
  failTutorMessage(id: string, errorCode: string): Promise<void>;
  saveState(conversationId: string, state: LearnerState, mode: Mode): Promise<void>;
  /**
   * Patch only `history_summary` and `summarized_through_message_id` in the stored state, so the
   * summarizer (run after a turn) cannot overwrite a newer turn's state.
   */
  saveSummary(conversationId: string, summary: string, throughMessageId: string): Promise<void>;
}

export interface UsageRepo {
  /** Returns the new count for the day. */
  incrementTurn(studentId: string, day: string): Promise<number>;
}

export interface LlmCallRecord {
  conversationId: string | null;
  purpose: Purpose;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  costEur: number;
  latencyMs: number;
  ttftMs: number | null;
  ok: boolean;
  errorCode: LlmErrorCode | null;
  meta: Record<string, unknown>;
}

export interface LlmCallRepo {
  record(call: LlmCallRecord): Promise<void>;
}

export interface ProfileRepo {
  getTutorContext(studentId: string): Promise<{ projectDescription: string | null }>;
}

/** Pino-compatible subset. */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
