import { jsonError } from "../../../../lib/chat/turn";
import { apiInstructor, uniqueViolation } from "../../../../lib/admin/api";
import { CreateModuleBody, OrderBody } from "../../../../lib/admin/schemas";
import { crossOrigin, readJson } from "../../../../lib/http";

/** GET /api/admin/modules: all modules (any status) with their papers (FR-6.1, FR-6.2). */
export async function GET() {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const [modules, papers] = await Promise.all([auth.repo.modules(), auth.repo.papers()]);
  return Response.json({
    modules: modules.map((m) => ({ ...m, papers: papers.filter((p) => p.moduleId === m.id) })),
  });
}

/** POST /api/admin/modules `{ slug, title, description? }` → the new module (status draft). */
export async function POST(request: Request) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const body = CreateModuleBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", body.error.issues[0]!.message);
  try {
    const module = await auth.repo.createModule(body.data);
    await auth.repo.logEvent("module_created", auth.user.id, { module_id: module.id });
    return Response.json({ module }, { status: 201 });
  } catch (e) {
    return uniqueViolation(e, "module") ?? Promise.reject(e);
  }
}

/** PATCH /api/admin/modules `{ order: [ids] }`: reorder (drag & drop or keyboard, FR-6.1). */
export async function PATCH(request: Request) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const body = OrderBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", "Invalid order.");
  await auth.repo.reorderModules(body.data.order);
  return new Response(null, { status: 204 });
}
