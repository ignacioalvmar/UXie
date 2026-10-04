import { DbError } from "@uxie/db";
import { jsonError } from "../../../../../../lib/chat/turn";
import { apiInstructor } from "../../../../../../lib/admin/api";
import { crossOrigin, isUuid } from "../../../../../../lib/http";

/**
 * POST /api/admin/versions/:id/copy → `{ versionId }` (ADR-027): a new version with the same PDF,
 * pages and guide (as a draft), so a published guide can be corrected without a new upload.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const source = isUuid(id) ? await auth.repo.version(id) : null;
  if (!source) return jsonError(404, "not_found", "Version not found.");
  try {
    const copy = await auth.repo.cloneVersion(id, auth.user.id);
    await auth.repo.logEvent("version_copied", auth.user.id, {
      paper_id: source.paperId,
      from_version_id: id,
      version_id: copy.id,
    });
    return Response.json({ versionId: copy.id, versionNo: copy.versionNo }, { status: 201 });
  } catch (e) {
    if (e instanceof DbError && e.code === "version_not_ready")
      return jsonError(409, "version_not_ready", e.message);
    throw e;
  }
}
