import { jsonError } from "../../../../../../lib/chat/turn";
import { apiInstructor } from "../../../../../../lib/admin/api";
import { TestChatBody } from "../../../../../../lib/admin/schemas";
import { testChatDeps, testChatStore } from "../../../../../../lib/admin/testChat";
import { handleTestChat } from "../../../../../../lib/admin/testChatTurn";
import { crossOrigin, isUuid, readJson } from "../../../../../../lib/http";

export const maxDuration = 120;

/**
 * POST /api/admin/versions/:id/test-chat (FR-6.5): like the student messages route, plus the
 * debug panel in the finish metadata. Allowed on unpublished versions; `is_test` conversations
 * are excluded from reports and exports.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Version not found.");
  const body = TestChatBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", "Invalid request.");
  const store = testChatStore();
  return handleTestChat(store, testChatDeps(store), {
    instructorId: auth.user.id,
    versionId: id,
    ...body.data,
  });
}
