import { DataRightsRepo, isOverdue } from "@uxie/db";
import { apiInstructor } from "../../../../lib/admin/api";
import { serviceDb } from "../../../../lib/supabase/server";

/** GET /api/admin/data-requests[?open=1]: requests with due dates, overdue flagged (FR-8.2). */
export async function GET(request: Request) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const openOnly = new URL(request.url).searchParams.get("open") === "1";
  const now = new Date();
  const requests = await new DataRightsRepo(serviceDb()).listRequests({ openOnly });
  return Response.json({
    requests: requests.map(({ studentId: _omit, ...r }) => ({ ...r, overdue: isOverdue(r, now) })),
  });
}
