import { regenerateChecked } from "@uxie/db";
import { jsonError } from "../../../../../../../lib/chat/turn";
import { apiInstructor, contentResponse } from "../../../../../../../lib/admin/api";
import { crossOrigin, isUuid } from "../../../../../../../lib/http";

/** POST /api/admin/versions/:id/guide/regenerate → `{ jobId }`; the worker re-drafts (FR-6.4). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Version not found.");
  const result = await regenerateChecked(auth.repo, id);
  if (result.ok)
    await auth.repo.logEvent("guide_regenerate_requested", auth.user.id, { version_id: id });
  return contentResponse(result, (r) => ({ jobId: r.job.id }));
}
