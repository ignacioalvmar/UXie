import { chatDeps } from "../../../../../lib/chat/store";
import { handleReset, jsonError } from "../../../../../lib/chat/turn";
import { apiUser, crossOrigin, isUuid } from "../../../../../lib/http";

/**
 * POST /api/conversations/:id/reset → `{ newConversationId }` (FR-3.5, PRD §11). The old
 * conversation keeps its messages with status `reset`; the new one starts from scratch.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Conversation not found.");
  return handleReset(chatDeps(), { studentId: auth.user.id, conversationId: id });
}
