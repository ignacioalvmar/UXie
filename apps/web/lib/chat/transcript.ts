import type { HelpLevel } from "@uxie/core";
import type { ChatMessageDto, ChatUIMessage } from "./types";

/**
 * Server transcript → useChat messages (resume, refresh after Stop). Pure and browser-safe.
 * Student messages keep their `clientMessageId` as id, so Retry re-sends the same key (NFR-14).
 * Failed replies that were later regenerated are dropped; a trailing unanswered turn is reported
 * so the UI can offer "Try again". The `start` event stays in the list (hidden by the UI) so a
 * failed opening can be retried with its own key.
 */

export function parseHelp(label: string | null): HelpLevel {
  if (label?.startsWith("hint:")) return { kind: "hint", index: Number(label.slice(5)) || 0 };
  if (label === "explain" || label === "check") return { kind: label };
  return { kind: "ask" };
}

export interface Transcript {
  messages: ChatUIMessage[];
  /** The last turn has no completed reply (failed, or a stale stream): offer Try again. */
  lastReplyFailed: boolean;
  /** A reply is being generated right now (another tab, or after a reload). */
  pending: boolean;
}

export function toTranscript(messages: ChatMessageDto[], generating: boolean): Transcript {
  const out: ChatUIMessage[] = [];
  for (const m of messages) {
    if (m.role === "tutor") {
      if (m.status !== "complete") continue;
      out.push({
        id: m.id,
        role: "assistant",
        parts: [{ type: "text", text: m.content }],
        metadata: {
          tutorMessageId: m.id,
          status: "complete",
          text: m.content,
          citations: m.citations,
          help: parseHelp(m.helpLevel),
          ...(m.feedback ? { feedback: m.feedback } : {}),
        },
      });
    } else {
      out.push({
        id: m.clientMessageId ?? m.id,
        role: "user",
        parts: [{ type: "text", text: m.content }],
        metadata: m.event
          ? {
              event: m.event,
              ...(m.event === "mode_switch" && m.mode ? { switchTo: m.mode } : {}),
            }
          : {},
      });
    }
  }
  const last = messages.at(-1);
  const unanswered = !!last && (last.role !== "tutor" || last.status !== "complete");
  return {
    messages: out,
    lastReplyFailed: unanswered && !generating,
    pending: unanswered && generating,
  };
}

/** The student turn a Retry should re-send: the last user message, its text and event. */
export function lastStudentTurn(messages: ChatUIMessage[]) {
  const m = [...messages].reverse().find((x) => x.role === "user");
  if (!m) return null;
  const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  return {
    clientMessageId: m.id,
    text,
    event: m.metadata?.event ?? null,
    switchTo: m.metadata?.switchTo ?? null,
  };
}

/**
 * Where the transport sends a student turn (PRD §11). No conversation yet, or the `start` event:
 * `POST /api/conversations` (creates it, FR-3.2, with the chosen mode). A mode switch:
 * `POST …/mode`. Otherwise `POST …/messages` with text or the `stuck` event.
 */
export function requestFor(
  turn: NonNullable<ReturnType<typeof lastStudentTurn>>,
  conversationId: string | null,
  paperSlug: string,
): { api: string; body: Record<string, unknown> } {
  const { clientMessageId } = turn;
  if (!conversationId || turn.event === "start")
    return {
      api: "/api/conversations",
      body: {
        paperSlug,
        clientMessageId,
        ...(turn.switchTo ? { mode: turn.switchTo } : {}),
        ...(turn.event ? {} : { text: turn.text }),
      },
    };
  if (turn.event === "mode_switch")
    return {
      api: `/api/conversations/${conversationId}/mode`,
      body: { clientMessageId, mode: turn.switchTo },
    };
  return {
    api: `/api/conversations/${conversationId}/messages`,
    body:
      turn.event === "stuck"
        ? { clientMessageId, event: "stuck" }
        : { clientMessageId, text: turn.text },
  };
}

export const messageText = (m: ChatUIMessage) =>
  m.metadata?.text ?? m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
