// FR-9.5: unauthenticated liveness check without details. DB reachability is added in M5.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true });
}
