import { classReportMarkdown } from "@uxie/core";
import { ReviewRepo } from "@uxie/db";
import { apiInstructor } from "../../../../../lib/admin/api";
import { jsonError } from "../../../../../lib/chat/turn";
import { isUuid } from "../../../../../lib/http";
import { serviceDb } from "../../../../../lib/supabase/server";

type Ctx = { params: Promise<{ paperId: string }> };

/** GET /api/admin/reports/:paperId → report JSON, or `?format=md` → Markdown download (FR-7.2). */
export async function GET(request: Request, ctx: Ctx) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { paperId } = await ctx.params;
  const report = isUuid(paperId) ? await new ReviewRepo(serviceDb()).classReport(paperId) : null;
  if (!report) return jsonError(404, "not_found", "Paper not found.");
  if (new URL(request.url).searchParams.get("format") !== "md") return Response.json(report);
  return new Response(classReportMarkdown(report), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="report-${report.paper.slug}-${report.generatedAt.slice(0, 10)}.md"`,
      "cache-control": "no-store",
    },
  });
}
