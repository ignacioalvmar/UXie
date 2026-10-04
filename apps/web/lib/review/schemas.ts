import { z } from "zod";
import { ExportFiltersSchema, ExportFormat, Mode, PgUuid } from "@uxie/core";

/** Request shapes of the M9 admin routes (PRD §11), zod-validated. */

const uuid = PgUuid;
const day = z.iso.date();
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

/** FR-7.1 filters from a query string (`?paper=…&mode=…&from=…&feedback=1&page=2`). */
export const ReviewQuery = z.object({
  module: z.preprocess(blank, uuid.optional()),
  paper: z.preprocess(blank, uuid.optional()),
  version: z.preprocess(blank, uuid.optional()),
  pseudonym: z.preprocess(blank, z.string().trim().max(40).optional()),
  mode: z.preprocess(blank, Mode.optional()),
  from: z.preprocess(blank, day.optional()),
  to: z.preprocess(blank, day.optional()),
  feedback: z.preprocess(blank, z.enum(["1"]).optional()),
  page: z.preprocess(blank, z.coerce.number().int().min(1).max(10_000).optional()),
});
export type ReviewQuery = z.infer<typeof ReviewQuery>;

export const REVIEW_PAGE_SIZE = 50;

/** Parse search params leniently: invalid values are dropped rather than failing the page. */
export function parseReviewQuery(
  params: Record<string, string | string[] | undefined>,
): ReviewQuery {
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(ReviewQuery.shape) as (keyof ReviewQuery)[]) {
    const one = ReviewQuery.shape[key].safeParse(flat[key]);
    if (one.success && one.data !== undefined) out[key] = one.data;
  }
  return out as ReviewQuery;
}

export const toReviewFilters = (q: ReviewQuery) => ({
  ...(q.module ? { moduleId: q.module } : {}),
  ...(q.paper ? { paperId: q.paper } : {}),
  ...(q.version ? { versionId: q.version } : {}),
  ...(q.pseudonym ? { pseudonym: q.pseudonym } : {}),
  ...(q.mode ? { mode: q.mode } : {}),
  ...(q.from ? { from: q.from } : {}),
  ...(q.to ? { to: q.to } : {}),
  ...(q.feedback ? { hasFeedback: true } : {}),
});

/** POST /api/admin/exports (FR-7.3). */
export const ExportBody = z
  .object({
    filters: ExportFiltersSchema.default({}),
    format: ExportFormat,
    researchOnly: z.boolean(),
  })
  .strict();

/** PATCH /api/admin/data-requests/:id (FR-8.2, FR-8.3). */
export const DataRequestPatch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("in_progress") }),
  z.object({ action: z.literal("reject"), notes: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("complete"), confirmPseudonym: z.string().trim() }),
]);

export const MonthQuery = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
