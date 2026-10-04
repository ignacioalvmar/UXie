import { enabledModes } from "../../../../lib/chat/store";
import { jsonError } from "../../../../lib/chat/turn";
import { apiUser, isUuid } from "../../../../lib/http";
import { loadWorkspace } from "../../../../lib/views";

/** GET /api/papers/:slug?c=: paper, version meta, warnings, conversation summary (FR-3.1). */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { slug } = await ctx.params;
  const c = new URL(request.url).searchParams.get("c");
  const result = await loadWorkspace(auth.user.id, slug, c && isUuid(c) ? c : null, {
    modes: enabledModes(),
    projectDescription: auth.profile.projectDescription,
  });
  if (result.kind === "not_found") return jsonError(404, "not_found", "Paper not found.");
  if (result.kind === "unavailable")
    return jsonError(410, "paper_unavailable", "This paper is no longer available.");
  return Response.json(result.workspace);
}
