import { jsonError } from "../../../../../lib/chat/turn";
import { apiInstructor } from "../../../../../lib/admin/api";
import { isUuid } from "../../../../../lib/http";

/** GET /api/admin/ingest-jobs/:id: job status for the upload progress (FR-5.1 step 5). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const job = isUuid(id) ? await auth.repo.job(id) : null;
  if (!job) return jsonError(404, "not_found", "Job not found.");
  const version = await auth.repo.version(job.versionId);
  return Response.json(
    { job, versionStatus: version?.status ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
