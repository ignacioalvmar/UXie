import { jsonError } from "../../../../../lib/chat/turn";
import { apiInstructor } from "../../../../../lib/admin/api";
import { loadPaperAdmin } from "../../../../../lib/admin/views";
import { DeleteBody, PatchPaperBody } from "../../../../../lib/admin/schemas";
import { crossOrigin, isUuid, readJson } from "../../../../../lib/http";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/papers/:id: paper, versions (status, guide, latest job, conversations). */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const view = isUuid(id) ? await loadPaperAdmin(auth.repo, id) : null;
  if (!view) return jsonError(404, "not_found", "Paper not found.");
  return Response.json(view);
}

/**
 * PATCH /api/admin/papers/:id — one of `{ title?, authors?, year? }`, `{ moduleId }` (move; old
 * conversations keep module_*_at_start) or `{ retired }` (retire / un-retire), FR-6.2.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const paper = isUuid(id) ? await auth.repo.paper(id) : null;
  if (!paper) return jsonError(404, "not_found", "Paper not found.");
  const body = PatchPaperBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", body.error.issues[0]!.message);
  const b = body.data;
  if ("moduleId" in b) {
    if (!(await auth.repo.modules()).some((m) => m.id === b.moduleId))
      return jsonError(400, "invalid_input", "Module not found.");
    const moved = await auth.repo.movePaper(id, b.moduleId);
    await auth.repo.logEvent("paper_moved", auth.user.id, {
      paper_id: id,
      from_module_id: paper.moduleId,
      to_module_id: b.moduleId,
    });
    return Response.json({ paper: moved });
  }
  if ("retired" in b) {
    const updated = await auth.repo.setRetired(id, b.retired);
    await auth.repo.logEvent(b.retired ? "paper_retired" : "paper_unretired", auth.user.id, {
      paper_id: id,
    });
    return Response.json({ paper: updated });
  }
  return Response.json({ paper: await auth.repo.updatePaper(id, b) });
}

/**
 * DELETE /api/admin/papers/:id?preview=1 → the impact (FR-6.7). Without `preview`, body
 * `{ confirmSlug, researchChecked }` deletes rows and Storage files and writes an audit event.
 */
export async function DELETE(request: Request, ctx: Ctx) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const paper = isUuid(id) ? await auth.repo.paper(id) : null;
  if (!paper) return jsonError(404, "not_found", "Paper not found.");
  const impact = await auth.repo.deletionImpact({ paperId: id });
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
  const { files } = await auth.repo.deletePaper(id);
  await auth.repo.logEvent("paper_deleted", auth.user.id, {
    paper_id: id,
    paper_slug: paper.slug,
    ...impact,
    files_removed: files,
    research_checked: body.data.researchChecked,
  });
  return Response.json({ deleted: true, impact });
}
