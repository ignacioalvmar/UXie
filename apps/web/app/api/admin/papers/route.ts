import { jsonError } from "../../../../lib/chat/turn";
import { apiInstructor, uniqueViolation } from "../../../../lib/admin/api";
import { CreatePaperBody, PaperOrderBody } from "../../../../lib/admin/schemas";
import { crossOrigin, readJson } from "../../../../lib/http";

/** POST /api/admin/papers `{ moduleId, slug, title, authors, year }` → paper (draft, FR-6.2). */
export async function POST(request: Request) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const body = CreatePaperBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", body.error.issues[0]!.message);
  try {
    const paper = await auth.repo.createPaper(body.data);
    await auth.repo.logEvent("paper_created", auth.user.id, { paper_id: paper.id });
    return Response.json({ paper }, { status: 201 });
  } catch (e) {
    return uniqueViolation(e, "paper") ?? Promise.reject(e);
  }
}

/** PATCH /api/admin/papers `{ moduleId, order: [ids] }`: reorder papers in a module (FR-6.2). */
export async function PATCH(request: Request) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const body = PaperOrderBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", "Invalid order.");
  await auth.repo.reorderPapers(body.data.moduleId, body.data.order);
  return new Response(null, { status: 204 });
}
