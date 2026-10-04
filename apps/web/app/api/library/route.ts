import { apiUser } from "../../../lib/http";
import { loadLibrary } from "../../../lib/views";

/** GET /api/library: modules → papers (published) with conversation hints (FR-2.1, FR-2.2). */
export async function GET() {
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  return Response.json(await loadLibrary(auth.user.id));
}
