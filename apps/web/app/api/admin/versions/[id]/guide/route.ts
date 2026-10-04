import { saveGuideChecked } from "@uxie/db";
import { jsonError } from "../../../../../../lib/chat/turn";
import { apiInstructor, contentResponse } from "../../../../../../lib/admin/api";
import { parseGuideYaml } from "../../../../../../lib/admin/guideYaml";
import { PutGuideBody } from "../../../../../../lib/admin/schemas";
import { loadVersionAdmin } from "../../../../../../lib/admin/views";
import { crossOrigin, isUuid, readJson } from "../../../../../../lib/http";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/versions/:id/guide: YAML, status, hash and current issues (FR-6.4). */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const view = isUuid(id) ? await loadVersionAdmin(auth.repo, id) : null;
  if (!view) return jsonError(404, "not_found", "Version not found.");
  return Response.json(view.guide, { headers: { "cache-control": "no-store" } });
}

/**
 * PUT /api/admin/versions/:id/guide `{ yaml }`: saves the guide as a draft even when it has
 * issues (they are returned and block approval); a YAML syntax error is refused (422).
 */
export async function PUT(request: Request, ctx: Ctx) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Version not found.");
  const body = PutGuideBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", "Send { yaml }.");
  const parsed = parseGuideYaml(body.data.yaml);
  if (!parsed.ok)
    return Response.json(
      {
        code: "yaml_invalid",
        message: `YAML: ${parsed.error}`,
        issues: [{ path: parsed.line ? `line ${parsed.line}` : "(yaml)", message: parsed.error }],
      },
      { status: 422 },
    );
  const result = await saveGuideChecked(auth.repo, {
    versionId: id,
    guide: parsed.value,
    source: "editor",
    actorId: auth.user.id,
  });
  return contentResponse(result, (r) => ({
    status: r.guide.status,
    guideHash: r.guide.guideHash,
    updatedAt: r.guide.updatedAt,
    issues: r.issues,
  }));
}
