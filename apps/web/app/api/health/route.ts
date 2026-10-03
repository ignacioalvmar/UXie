import { pingDb } from "@uxie/db";
import { serviceDb } from "../../../lib/supabase/server";

// FR-9.5: unauthenticated liveness check without details: is the database reachable?
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await pingDb(serviceDb()).catch(() => false);
  return Response.json({ ok: db }, { status: db ? 200 : 503 });
}