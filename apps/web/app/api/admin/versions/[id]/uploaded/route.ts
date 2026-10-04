import { jsonError } from "../../../../../../lib/chat/turn";
import { apiInstructor } from "../../../../../../lib/admin/api";
import { serverEnv } from "../../../../../../lib/env";
import { crossOrigin, isUuid } from "../../../../../../lib/http";

/**
 * POST /api/admin/versions/:id/uploaded → `{ jobId }` (FR-5.1 step 3): checks the object exists
 * and its size, sets the version to `processing` and queues the ingest job for the worker.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const version = isUuid(id) ? await auth.repo.version(id) : null;
  if (!version) return jsonError(404, "not_found", "Version not found.");
  if (version.status !== "uploading")
    return jsonError(409, "already_uploaded", "This version was already uploaded.");
  const maxBytes = serverEnv().MAX_PDF_MB * 1024 * 1024;
  const size = await auth.repo.uploadedSize(version.pdfPath);
  if (size === null) return jsonError(409, "upload_missing", "The PDF has not arrived yet.");
  if (size > maxBytes)
    return jsonError(413, "too_large", `The PDF is larger than ${serverEnv().MAX_PDF_MB} MB.`);
  const job = await auth.repo.queueIngest(id);
  await auth.repo.logEvent("version_uploaded", auth.user.id, {
    paper_id: version.paperId,
    version_id: id,
    size_bytes: size,
  });
  return Response.json({ jobId: job.id }, { status: 202 });
}
