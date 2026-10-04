import type { Mode, TurnEvent } from "@uxie/core";
import {
  handleTurn,
  jsonError,
  type ChatDeps,
  type ChatStore,
  type OpenResult,
} from "../chat/turn";

/**
 * "Test as student" turns (FR-6.5) on top of the student turn adapter. Without a
 * `conversationId` a new test conversation opens (the previous one closes) and UXie greets, or
 * answers `text` directly; with one, the turn continues it. The adapter adds the debug panel
 * (`deps.debug`).
 */

export interface TestChatStore extends ChatStore {
  openTestConversation(instructorId: string, versionId: string, mode: Mode): Promise<OpenResult>;
}

export interface TestChatInput {
  instructorId: string;
  versionId: string;
  clientMessageId: string;
  conversationId?: string;
  text?: string;
  event?: "stuck" | "mode_switch";
  mode?: Mode;
}

export async function handleTestChat(
  store: TestChatStore,
  deps: ChatDeps,
  input: TestChatInput,
): Promise<Response> {
  const text = input.text?.trim();
  let conversationId = input.conversationId;
  let event: TurnEvent;

  if (conversationId) {
    const conv = await store.ownConversation(input.instructorId, conversationId);
    if (!conv || conv.paperVersionId !== input.versionId)
      return jsonError(404, "not_found", "Test conversation not found.");
    if (input.event === "mode_switch") event = { type: "mode_switch", mode: input.mode! };
    else if (input.event === "stuck") event = { type: "stuck" };
    else if (text) event = { type: "message" };
    else return jsonError(400, "invalid_input", "Send text or an event.");
  } else {
    const opened = await store.openTestConversation(
      input.instructorId,
      input.versionId,
      input.mode ?? "understand",
    );
    if (!opened.ok) return jsonError(opened.status, opened.code, opened.message);
    conversationId = opened.conversationId;
    event = text ? { type: "message" } : { type: "start" };
  }

  return handleTurn(
    { ...deps, store },
    {
      studentId: input.instructorId,
      conversationId,
      clientMessageId: input.clientMessageId,
      ...(event.type === "message" ? { text } : {}),
      event,
    },
  );
}
