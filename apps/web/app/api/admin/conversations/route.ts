import { ReviewRepo } from "@uxie/db";
import { apiInstructor } from "../../../../lib/admin/api";
import {
  parseReviewQuery,
  REVIEW_PAGE_SIZE,
  toReviewFilters,
} from "../../../../lib/review/schemas";
import { serviceDb } from "../../../../lib/supabase/server";

/** GET /api/admin/conversations?module&paper&version&pseudonym&mode&from&to&feedback=1&page (FR-7.1). */
export async function GET(request: Request) {
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const q = parseReviewQuery(Object.fromEntries(new URL(request.url).searchParams));
  const page = q.page ?? 1;
  const list = await new ReviewRepo(serviceDb()).listConversations(toReviewFilters(q), {
    limit: REVIEW_PAGE_SIZE,
    offset: (page - 1) * REVIEW_PAGE_SIZE,
  });
  return Response.json({ ...list, page, pageSize: REVIEW_PAGE_SIZE });
}
