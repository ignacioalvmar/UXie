import { retryIngestChecked } from "@uxie/db";
import { jsonError } from "../../../../../../lib/chat/turn";
import { apiInstructor, contentResponse } from "../../../../../../lib/admin/api";
import { RetryBody } from "../../../../../../lib/admin/schemas";
import { serverEnv } from "../../../../../../lib/env";
import { crossOrigin, isUuid, readJson } from "../../../../../../lib/http";

/** POST /api/admin/versions/:id/retry `{ extractor? }` → `{ jobId }`: ingest a failed version again (FR-5.5). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Version not found.");
  const body = RetryBody.safeParse((await readJson(request)) ?? {});
  if (!body.success) return jsonError(400, "invalid_input", "Invalid extractor.");
  if (body.data.extractor === "docling" && !serverEnv().DOCLING_URL)
    return jsonError(400, "docling_unavailable", "docling is not configured (DOCLING_URL).");
  const result = await retryIngestChecked(auth.repo, id, body.data.extractor);
  return contentResponse(result, (r) => ({ jobId: r.job.id }));
}
