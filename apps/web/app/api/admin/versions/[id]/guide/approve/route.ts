import { approveGuideChecked } from "@uxie/db";
import { jsonError } from "../../../../../../../lib/chat/turn";
import { apiInstructor, contentResponse } from "../../../../../../../lib/admin/api";
import { ApproveBody } from "../../../../../../../lib/admin/schemas";
import { crossOrigin, isUuid, readJson } from "../../../../../../../lib/http";

/**
 * POST /api/admin/versions/:id/guide/approve `{ guideHash? }` (FR-6.4): only a valid guide, and
 * only the version of it the instructor was looking at (`guideHash`).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Version not found.");
  const body = ApproveBody.safeParse((await readJson(request)) ?? {});
  if (!body.success) return jsonError(400, "invalid_input", "Invalid request.");
  const result = await approveGuideChecked(auth.repo, {
    versionId: id,
    actorId: auth.user.id,
    expectedHash: body.data.guideHash,
  });
  if (result.ok) await auth.repo.logEvent("guide_approved", auth.user.id, { version_id: id });
  return contentResponse(result, (r) => ({
    status: r.guide.status,
    approvedAt: r.guide.approvedAt,
    guideHash: r.guide.guideHash,
  }));
}
