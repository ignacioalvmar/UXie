import { DataRightsRepo } from "@uxie/db";
import { apiUser } from "../../../../lib/http";
import { serviceDb } from "../../../../lib/supabase/server";

/**
 * GET /api/me/export → JSON download of everything stored about the student, including the
 * email (FR-8.1). Logged as a completed `access` request.
 */
export async function GET() {
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const data = await new DataRightsRepo(serviceDb()).exportPersonalData(
    auth.user.id,
    auth.user.email,
  );
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="uxie-my-data-${data.exportedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
