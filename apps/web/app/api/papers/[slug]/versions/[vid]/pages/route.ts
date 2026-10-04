import { jsonError } from "../../../../../../../lib/chat/turn";
import { apiUser, isUuid } from "../../../../../../../lib/http";
import { readableVersion, views } from "../../../../../../../lib/views";

/**
 * GET …/versions/:vid/pages: extracted text of every page, for the accessible-text view and
 * in-document search (FR-3.3). One request instead of one per page (ADR-025).
 */
export async function GET(_: Request, ctx: { params: Promise<{ slug: string; vid: string }> }) {
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { slug, vid } = await ctx.params;
  const meta = isUuid(vid) ? await readableVersion(auth.user.id, slug, vid) : null;
  if (!meta) return jsonError(404, "not_found", "Not found.");
  // Versions are immutable (ADR-009); the browser may keep the text for the session.
  return Response.json(
    { pages: await views().pages(vid) },
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
}
