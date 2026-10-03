import { z } from "zod";

/** Extracted paper text, one entry per PDF page (PRD §3.6, §9.1 `paper_pages`). */
export const PageSchema = z.object({
  n: z.number().int().positive(),
  text: z.string(),
});
export type Page = z.infer<typeof PageSchema>;

export const ExtractionWarningKind = z.enum([
  "scanned_or_figure_only",
  "token_count_high",
  "references_start",
  "extraction_failed",
]);

export const ExtractionWarningSchema = z.object({
  kind: ExtractionWarningKind,
  /** Page the warning applies to; absent for whole-document warnings. */
  page: z.number().int().positive().optional(),
  message: z.string(),
});
export type ExtractionWarning = z.infer<typeof ExtractionWarningSchema>;

/**
 * `fixtures/papers/<slug>/pages.json` and the output of `pnpm uxie ingest --local` (FR-5.6).
 * Pages must be numbered 1..N without gaps.
 */
export const PagesFileSchema = z
  .object({
    title: z.string().min(1),
    authors: z.array(z.string()).default([]),
    year: z.number().int().optional(),
    extractor: z.string().optional(),
    warnings: z.array(ExtractionWarningSchema).default([]),
    pages: z.array(PageSchema).min(1),
  })
  .refine((f) => f.pages.every((p, i) => p.n === i + 1), {
    message: "pages must be numbered 1..N in order",
    path: ["pages"],
  });
export type PagesFile = z.infer<typeof PagesFileSchema>;
