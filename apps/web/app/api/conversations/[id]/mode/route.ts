import { z } from "zod";
import { Mode } from "@uxie/core";
import { chatDeps } from "../../../../../lib/chat/store";
import { handleTurn, jsonError } from "../../../../../lib/chat/turn";
import { apiUser, crossOrigin, isUuid, readJson } from "../../../../../lib/http";

export const maxDuration = 120;

const ModeBody = z.object({ mode: Mode, clientMessageId: z.uuid() });

/**
 * POST /api/conversations/:id/mode `{ mode, clientMessageId }` → stream (FR-4.7, PRD §11): the
 * one-line handover and the continuation in the new mode; learner state is kept. Same rules as a
 * message turn (limits, lock, idempotent retry by clientMessageId).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Conversation not found.");
  const body = ModeBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", "Invalid request.");

  return handleTurn(chatDeps(), {
    studentId: auth.user.id,
    conversationId: id,
    clientMessageId: body.data.clientMessageId,
    event: { type: "mode_switch", mode: body.data.mode },
  });
}
