import { jsonError } from "../../../../../../../lib/chat/turn";
import { apiUser, isUuid } from "../../../../../../../lib/http";
import { readableVersion, views } from "../../../../../../../lib/views";

/** GET …/versions/:vid/pdf → 302 to a 10-minute signed Storage URL after the read check (§9.3). */
export async function GET(_: Request, ctx: { params: Promise<{ slug: string; vid: string }> }) {
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { slug, vid } = await ctx.params;
  const meta = isUuid(vid) ? await readableVersion(auth.user.id, slug, vid) : null;
  if (!meta) return jsonError(404, "not_found", "Not found.");
  const url = await views().signedPdfUrl(meta.pdfPath);
  if (!url) return jsonError(404, "pdf_missing", "The PDF file is not available.");
  return Response.redirect(url, 302);
}
