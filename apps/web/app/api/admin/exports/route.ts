import { buildExport, ReviewRepo } from "@uxie/db";
import { apiInstructor } from "../../../../lib/admin/api";
import { jsonError } from "../../../../lib/chat/turn";
import { crossOrigin, readJson } from "../../../../lib/http";
import { ExportBody } from "../../../../lib/review/schemas";
import { serviceDb } from "../../../../lib/supabase/server";

/**
 * POST /api/admin/exports `{ filters, format, researchOnly }` → file download (FR-7.3). Every
 * export writes `export_log`; GET lists the log.
 */
export async function POST(request: Request) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const body = ExportBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", body.error.issues[0]!.message);
  const file = await buildExport(new ReviewRepo(serviceDb()), {
    ...body.data,
    instructorId: auth.user.id,
    channel: "web",
  });
  await auth.repo.logEvent("export", auth.user.id, {
    format: body.data.format,
    research_only: body.data.researchOnly,
    rows: file.rowCount,
  });
  return new Response(file.body, {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.filename}"`,
      "x-row-count": String(file.rowCount),
      "cache-control": "no-store",
    },
  });
}

export async function GET() {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  return Response.json({ log: await new ReviewRepo(serviceDb()).exportLog() });
}
