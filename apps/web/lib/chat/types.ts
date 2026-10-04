import type { UIMessage } from "ai";
import type { Citation, HelpLevel, Mode, ObjectiveKind, ObjectiveStatus } from "@uxie/core";

/**
 * Shapes shared by the chat routes and the browser (PRD §11). Nothing here may carry teaching-guide
 * internals: objectives travel as statement, kind, status, evidence and page refs only.
 */

export interface ProgressDto {
  id: string;
  kind: ObjectiveKind;
  statement: string;
  status: ObjectiveStatus;
  evidence: string | null;
  active: boolean;
  refs: { page: number; label?: string }[];
}

export interface TurnFlagsDto {
  shortcutRequest: boolean;
  offTopic: boolean;
}

/**
 * Metadata of a streamed tutor message. The `start` part carries ids and the help level (known
 * before the first token); the `finish` part carries the final text (invalid citations removed),
 * the valid citations and the updated progress.
 */
export interface TutorMeta {
  conversationId?: string;
  tutorMessageId?: string;
  studentMessageId?: string;
  help?: HelpLevel;
  flags?: TurnFlagsDto;
  replayed?: boolean;
  status?: "complete";
  /** The conversation's mode after the turn (changes on a mode switch, FR-4.7). */
  mode?: Mode;
  text?: string;
  citations?: Citation[];
  progress?: ProgressDto[];
  /** Objectives that became demonstrated in this turn (statements), for the announcement. */
  demonstrated?: string[];
  /** Client only: a button event shown in the transcript ("Explain it to me"). */
  event?: string;
  /** Client only: the mode a `mode_switch` event asks for. */
  switchTo?: Mode;
  /** The student's rating of this tutor message (FR-3.6). */
  feedback?: FeedbackDto;
  /** Client only: a reply that failed or was interrupted and is not saved. */
  failed?: boolean;
}

export type ChatUIMessage = UIMessage<TutorMeta>;

export interface FeedbackDto {
  rating: 1 | -1;
  comment: string | null;
}

export interface ChatMessageDto {
  id: string;
  role: "student" | "tutor" | "event";
  content: string;
  status: "complete" | "streaming" | "failed";
  event: string | null;
  mode: Mode | null;
  helpLevel: string | null;
  clientMessageId: string | null;
  citations: Citation[];
  feedback: FeedbackDto | null;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  mode: Mode;
  status: "active" | "reset" | "closed";
  paperVersionId: string;
  isCurrentVersion: boolean;
  generating: boolean;
  messages: ChatMessageDto[];
  progress: ProgressDto[];
}

/** Error body of every API route (PRD §11). Limits add `retryAt`. */
export interface ApiErrorBody {
  code: string;
  message: string;
  retryAt?: string;
}

export function parseApiError(raw: string | undefined): ApiErrorBody {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<ApiErrorBody>;
    if (typeof parsed.code === "string")
      return {
        code: parsed.code,
        message: parsed.message ?? "",
        ...(parsed.retryAt ? { retryAt: parsed.retryAt } : {}),
      };
  } catch {
    // Not JSON: a network failure or an unexpected server error.
  }
  return { code: "network_error", message: raw ?? "" };
}
