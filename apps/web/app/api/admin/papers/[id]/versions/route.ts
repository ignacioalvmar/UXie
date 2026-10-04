import { jsonError } from "../../../../../../lib/chat/turn";
import { apiInstructor } from "../../../../../../lib/admin/api";
import { CreateVersionBody } from "../../../../../../lib/admin/schemas";
import { serverEnv } from "../../../../../../lib/env";
import { crossOrigin, isUuid, readJson } from "../../../../../../lib/http";

/**
 * POST /api/admin/papers/:id/versions `{ filename, sizeBytes }` → `{ versionId, signedUploadUrl,
 * token }` (FR-5.1 step 1). The browser then PUTs the PDF straight to Storage: Vercel functions
 * accept only ~4.5 MB bodies, so the file never passes through them.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const paper = isUuid(id) ? await auth.repo.paper(id) : null;
  if (!paper) return jsonError(404, "not_found", "Paper not found.");
  const body = CreateVersionBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", "Invalid upload request.");
  if (!/\.pdf$/i.test(body.data.filename))
    return jsonError(400, "invalid_input", "Upload a PDF file.");
  const maxMb = serverEnv().MAX_PDF_MB;
  if (body.data.sizeBytes > maxMb * 1024 * 1024)
    return jsonError(413, "too_large", `The PDF is larger than ${maxMb} MB.`);

  const { version, signedUploadUrl, token } = await auth.repo.createVersionUpload(id, auth.user.id);
  return Response.json(
    { versionId: version.id, versionNo: version.versionNo, signedUploadUrl, token },
    { status: 201 },
  );
}
