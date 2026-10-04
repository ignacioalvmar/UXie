import { monthOf } from "@uxie/core";
import { ReviewRepo } from "@uxie/db";
import { apiInstructor } from "../../../../lib/admin/api";
import { jsonError } from "../../../../lib/chat/turn";
import { serverEnv } from "../../../../lib/env";
import { MonthQuery } from "../../../../lib/review/schemas";
import { serviceDb } from "../../../../lib/supabase/server";

/** GET /api/admin/usage?month=YYYY-MM (default: this month): cost & latency metrics (FR-7.4). */
export async function GET(request: Request) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const raw = new URL(request.url).searchParams.get("month") ?? monthOf(new Date());
  const month = MonthQuery.safeParse(raw);
  if (!month.success) return jsonError(400, "invalid_input", "Month must look like 2026-10.");
  return Response.json(
    await new ReviewRepo(serviceDb()).usage(month.data, serverEnv().MONTHLY_SPEND_CEILING_EUR),
  );
}
