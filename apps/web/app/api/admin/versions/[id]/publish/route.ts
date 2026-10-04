import { publishChecked } from "@uxie/db";
import { jsonError } from "../../../../../../lib/chat/turn";
import { apiInstructor, contentResponse } from "../../../../../../lib/admin/api";
import { crossOrigin, isUuid } from "../../../../../../lib/http";

/**
 * POST /api/admin/versions/:id/publish (FR-6.6): requires a ready version and an approved, valid
 * guide. The previous published version becomes superseded; its conversations stay on it.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Version not found.");
  const result = await publishChecked(auth.repo, id);
  if (result.ok)
    await auth.repo.logEvent("version_published", auth.user.id, {
      paper_id: result.version.paperId,
      version_id: id,
      version_no: result.version.versionNo,
    });
  return contentResponse(result, (r) => ({ version: r.version }));
}
