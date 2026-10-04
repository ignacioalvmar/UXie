import { apiInstructor } from "../../../../lib/admin/api";
import { adminHealth } from "../../../../lib/review/health";

export const dynamic = "force-dynamic";

/** GET /api/admin/health (FR-9.5): DB, Storage, LLM ping (cached 60 s), last errors, worker. */
export async function GET() {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  return Response.json(await adminHealth());
}
