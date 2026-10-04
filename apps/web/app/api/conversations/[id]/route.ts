import { jsonError } from "../../../../lib/chat/turn";
import { apiUser, isUuid } from "../../../../lib/http";
import { conversationDto, views } from "../../../../lib/views";

/**
 * GET /api/conversations/:id: messages, mode, progress (objective statements, statuses,
 * evidence, refs; no guide internals). Used to resume and to refresh after Stop.
 */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const repo = views();
  const conv = isUuid(id) ? await repo.ownConversation(auth.user.id, id) : null;
  if (!conv) return jsonError(404, "not_found", "Conversation not found.");
  const [guide, papers] = await Promise.all([
    repo.guideSummary(conv.paperVersionId),
    repo.papersById([conv.paperId]),
  ]);
  return Response.json(
    await conversationDto(conv, guide, papers.get(conv.paperId)?.currentVersionId ?? null),
  );
}
