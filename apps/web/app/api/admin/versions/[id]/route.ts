import { jsonError } from "../../../../../lib/chat/turn";
import { apiInstructor } from "../../../../../lib/admin/api";
import { DeleteBody } from "../../../../../lib/admin/schemas";
import { loadVersionAdmin } from "../../../../../lib/admin/views";
import { crossOrigin, isUuid, readJson } from "../../../../../lib/http";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/versions/:id: extraction preview data, guide (YAML + issues), latest job. */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const view = isUuid(id) ? await loadVersionAdmin(auth.repo, id) : null;
  if (!view) return jsonError(404, "not_found", "Version not found.");
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}

/**
 * DELETE /api/admin/versions/:id?preview=1 → impact; without `preview`, body `{ confirmSlug,
 * researchChecked }` (the paper slug) deletes one version (FR-6.7). The paper's current version
 * cannot be deleted on its own.
 */
export async function DELETE(request: Request, ctx: Ctx) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const version = isUuid(id) ? await auth.repo.version(id) : null;
  const paper = version ? await auth.repo.paper(version.paperId) : null;
  if (!version || !paper) return jsonError(404, "not_found", "Version not found.");
  if (paper.currentVersionId === id)
    return jsonError(
      409,
      "current_version",
      "This is the paper's current version. Publish another version first, or delete the whole paper.",
    );
  const impact = await auth.repo.deletionImpact({ versionId: id });
  if (new URL(request.url).searchParams.get("preview") === "1") return Response.json({ impact });

  const body = DeleteBody.safeParse(await readJson(request));
  if (!body.success || body.data.confirmSlug !== paper.slug)
    return jsonError(
      400,
      "confirmation_required",
      `Type the paper slug "${paper.slug}" to confirm.`,
    );
  if (impact.researchConsentStudents > 0 && !body.data.researchChecked)
    return jsonError(
      409,
      "research_check_required",
      "Some affected students gave research consent: confirm you have checked research retention obligations.",
    );
  const { files } = await auth.repo.deleteVersion(id);
  await auth.repo.logEvent("version_deleted", auth.user.id, {
    paper_id: paper.id,
    version_id: id,
    version_no: version.versionNo,
    ...impact,
    files_removed: files,
    research_checked: body.data.researchChecked,
  });
  return Response.json({ deleted: true, impact });
}
