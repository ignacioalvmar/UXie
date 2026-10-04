import { jsonError } from "../../../../../../lib/chat/turn";
import { apiInstructor } from "../../../../../../lib/admin/api";
import { isUuid } from "../../../../../../lib/http";

/** GET /api/admin/versions/:id/pdf → 302 to a 10-minute signed URL (any status, instructors). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const version = isUuid(id) ? await auth.repo.version(id) : null;
  if (!version) return jsonError(404, "not_found", "Version not found.");
  const url = await auth.repo.signedPdfUrl(version.pdfPath);
  if (!url) return jsonError(404, "not_found", "The PDF file is missing.");
  return Response.redirect(url, 302);
}
