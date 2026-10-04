import { ReviewRepo } from "@uxie/db";
import { apiInstructor } from "../../../../../lib/admin/api";
import { jsonError } from "../../../../../lib/chat/turn";
import { isUuid } from "../../../../../lib/http";
import { serviceDb } from "../../../../../lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/conversations/:id: read-only transcript + state timeline (FR-7.1). */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const review = isUuid(id) ? await new ReviewRepo(serviceDb()).conversation(id) : null;
  if (!review) return jsonError(404, "not_found", "Conversation not found.");
  // The student's auth id stays on the server; the UI works with the pseudonym.
  const { studentId: _omit, ...conversation } = review.conversation;
  return Response.json({ ...review, conversation });
}
