import { jsonError } from "../../../../../lib/chat/turn";
import { apiInstructor } from "../../../../../lib/admin/api";
import { PatchModuleBody } from "../../../../../lib/admin/schemas";
import { crossOrigin, isUuid, readJson } from "../../../../../lib/http";

/** PATCH /api/admin/modules/:id `{ title?, description?, status? }`: rename, describe, publish, archive (FR-6.1). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Module not found.");
  const body = PatchModuleBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", body.error.issues[0]!.message);
  const module = await auth.repo.updateModule(id, body.data).catch(() => null);
  if (!module) return jsonError(404, "not_found", "Module not found.");
  if (body.data.status)
    await auth.repo.logEvent("module_status_changed", auth.user.id, {
      module_id: id,
      status: body.data.status,
    });
  return Response.json({ module });
}
