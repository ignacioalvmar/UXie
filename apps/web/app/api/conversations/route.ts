import { z } from "zod";
import { Mode } from "@uxie/core";
import { chatDeps, chatStore } from "../../../lib/chat/store";
import { handleTurn, jsonError } from "../../../lib/chat/turn";
import { apiUser, crossOrigin, readJson } from "../../../lib/http";
import { loadConversationList } from "../../../lib/views";

// Assessment + streamed reply; the reply is saved even if the client leaves (after()).
export const maxDuration = 120;

/** GET /api/conversations: the student's own conversations, grouped by paper (FR-3.9). */
export async function GET() {
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  return Response.json({ groups: await loadConversationList(auth.user.id) });
}

const CreateBody = z.object({
  paperSlug: z.string().min(1).max(200),
  clientMessageId: z.uuid(),
  /** The first student message (starter chip or typed); without it UXie opens (FR-4.1). */
  text: z.string().max(4000).optional(),
  mode: Mode.optional(),
});

/**
 * POST /api/conversations: the first chat action (FR-3.2). Creates the conversation on the
 * current version (or reuses the active one) and streams the reply to `text`, or the opening
 * message when there is no text. Metadata carries the `conversationId`.
 */
export async function POST(request: Request) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const body = CreateBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", "Invalid request.");

  const store = chatStore();
  const opened = await store.openConversation(auth.user.id, body.data.paperSlug, body.data.mode);
  if (!opened.ok) return jsonError(opened.status, opened.code, opened.message);

  const text = body.data.text?.trim();
  return handleTurn(chatDeps(store), {
    studentId: auth.user.id,
    conversationId: opened.conversationId,
    clientMessageId: body.data.clientMessageId,
    ...(text ? { text, event: { type: "message" } } : { event: { type: "start" } }),
  });
}
