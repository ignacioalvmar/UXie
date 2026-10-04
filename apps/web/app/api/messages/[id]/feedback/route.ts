import { z } from "zod";
import { FeedbackRepo } from "@uxie/db";
import { jsonError } from "../../../../../lib/chat/turn";
import { apiUser, crossOrigin, isUuid, readJson } from "../../../../../lib/http";
import { serviceDb } from "../../../../../lib/supabase/server";

const FeedbackBody = z.object({
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * POST /api/messages/:id/feedback `{ rating, comment? }` → 204 (FR-3.6). Rating again replaces
 * the earlier rating. Only completed tutor messages in the student's own conversations.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Message not found.");
  const body = FeedbackBody.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", "Invalid request.");

  const saved = await new FeedbackRepo(serviceDb()).save(
    auth.user.id,
    id,
    body.data.rating,
    body.data.comment || null,
  );
  if (!saved) return jsonError(404, "not_found", "Message not found.");
  return new Response(null, { status: 204 });
}
