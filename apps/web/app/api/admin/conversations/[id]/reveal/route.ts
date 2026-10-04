import { ReviewRepo } from "@uxie/db";
import { apiInstructor } from "../../../../../../lib/admin/api";
import { jsonError } from "../../../../../../lib/chat/turn";
import { crossOrigin, isUuid } from "../../../../../../lib/http";
import { serviceDb } from "../../../../../../lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/conversations/:id/reveal → `{ email }` (FR-7.1 "Reveal identity"). Every
 * reveal writes an `identity_revealed` audit event (ids only, never the email).
 */
export async function POST(request: Request, ctx: Ctx) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const repo = new ReviewRepo(serviceDb());
  const review = isUuid(id) ? await repo.conversation(id) : null;
  if (!review) return jsonError(404, "not_found", "Conversation not found.");
  const email = await repo.studentEmail(review.conversation.studentId);
  if (!email) return jsonError(404, "not_found", "The account no longer exists.");
  await auth.repo.logEvent("identity_revealed", auth.user.id, {
    conversation_id: id,
    pseudonym_id: review.conversation.pseudonymId,
  });
  return Response.json({ email });
}
