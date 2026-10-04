import { z } from "zod";
import { chatDeps } from "../../../../../lib/chat/store";
import { handleTurn, jsonError } from "../../../../../lib/chat/turn";
import { apiUser, crossOrigin, isUuid, readJson } from "../../../../../lib/http";

export const maxDuration = 120;

const MessageBody = z
  .object({
    clientMessageId: z.uuid(),
    text: z.string().max(4000).optional(),
    event: z.literal("stuck").optional(),
  })
  .refine((b) => (b.text?.trim() ? !b.event : b.event === "stuck"), "Send text or event");

/**
 * POST /api/conversations/:id/messages `{ clientMessageId, text? , event?: "stuck" }` → stream
 * (PRD §4.4, §11). Re-sending the same clientMessageId is a retry: the student message is not
 * duplicated; a completed reply is replayed, a failed one regenerated (NFR-14).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Conversation not found.");
  const body = MessageBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", "Invalid request.");

  return handleTurn(chatDeps(), {
    studentId: auth.user.id,
    conversationId: id,
    clientMessageId: body.data.clientMessageId,
    ...(body.data.event === "stuck"
      ? { event: { type: "stuck" } }
      : { text: body.data.text!.trim(), event: { type: "message" } }),
  });
}
