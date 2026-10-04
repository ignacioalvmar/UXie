import { jsonError } from "../../../../../../../../lib/chat/turn";
import { apiUser, isUuid } from "../../../../../../../../lib/http";
import { readableVersion, views } from "../../../../../../../../lib/views";

/** GET …/versions/:vid/pages/:n → `{ text }` (accessible text of one page, FR-3.3). */
export async function GET(
  _: Request,
  ctx: { params: Promise<{ slug: string; vid: string; n: string }> },
) {
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { slug, vid, n } = await ctx.params;
  const page = Number(n);
  const meta =
    isUuid(vid) && Number.isInteger(page) && page >= 1
      ? await readableVersion(auth.user.id, slug, vid)
      : null;
  if (!meta) return jsonError(404, "not_found", "Not found.");
  const text = await views().page(vid, page);
  if (text === null) return jsonError(404, "not_found", "No such page.");
  return Response.json({ text }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
