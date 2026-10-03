import { z } from "zod";

/** Teaching guide (PRD §3.1, §8.1). Instructor-approved; never sent to students' browsers. */

export const RefSchema = z.object({
  page: z.number().int().positive(),
  label: z.string().max(80).optional(),
});

export const ObjectiveKind = z.enum(["understanding", "application", "critique"]);
export type ObjectiveKind = z.infer<typeof ObjectiveKind>;

export const ObjectiveSchema = z.object({
  id: z.string().regex(/^[A-Z]\d{1,2}$/, "must look like U1, A2 or C10"),
  kind: ObjectiveKind,
  statement: z.string().min(10).max(300),
  refs: z.array(RefSchema).min(1),
  key_concepts: z.array(z.string()).min(1).max(8),
  question_ladder: z.array(z.string()).min(2).max(5),
  hints: z.array(z.string()).min(2).max(4),
  misconceptions: z.array(z.string()).max(5).default([]),
  mastery_check: z.string().min(10),
});

export const TeachingGuideSchema = z.object({
  schema_version: z.literal(1),
  title: z.string(),
  summary_for_tutor: z.string().max(1200),
  starter_questions: z.array(z.string()).min(2).max(4),
  objectives: z
    .array(ObjectiveSchema)
    .min(3)
    .max(8)
    .refine(
      (o) => o.some((x) => x.kind === "understanding") && o.some((x) => x.kind === "application"),
      "Need ≥1 understanding and ≥1 application objective",
    )
    .refine((o) => new Set(o.map((x) => x.id)).size === o.length, "Objective ids must be unique"),
  ux_scenarios: z.array(z.string()).min(1).max(6),
  discussion_prompts: z.array(z.string()).max(6).default([]),
  build_prompts: z.array(z.string()).max(6).default([]),
  evidence_limits: z.array(z.string()).max(6).default([]),
});

export type Ref = z.infer<typeof RefSchema>;
export type Objective = z.infer<typeof ObjectiveSchema>;
export type TeachingGuide = z.infer<typeof TeachingGuideSchema>;
/** Shape accepted before defaults are applied (e.g. a YAML file without empty optional lists). */
export type TeachingGuideInput = z.input<typeof TeachingGuideSchema>;

export interface GuideIssue {
  /** Human-readable location, e.g. `objectives[1].hints`. */
  path: string;
  message: string;
}

/** Semantic checks that need the paper: every referenced page exists (PRD §8.1). */
export function validateGuideAgainstPaper(guide: TeachingGuide, pageCount: number): GuideIssue[] {
  const issues: GuideIssue[] = [];
  guide.objectives.forEach((o, i) =>
    o.refs.forEach((r, j) => {
      if (r.page > pageCount) {
        issues.push({
          path: `objectives[${i}].refs[${j}].page`,
          message: `page ${r.page} does not exist (paper has ${pageCount} pages)`,
        });
      }
    }),
  );
  return issues;
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, "");
}

export type GuideValidation =
  | { ok: true; guide: TeachingGuide; issues: [] }
  | { ok: false; guide: TeachingGuide | null; issues: GuideIssue[] };

/**
 * Full validation for the guide editor, CLI push and ingestion: schema, then page refs when the
 * page count is known. `guide` is returned when the schema passes even if page checks fail.
 */
export function validateGuide(raw: unknown, pageCount?: number): GuideValidation {
  const parsed = TeachingGuideSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      guide: null,
      issues: parsed.error.issues.map((i) => ({
        path: formatPath(i.path) || "(guide)",
        message: i.message,
      })),
    };
  }
  const issues = pageCount === undefined ? [] : validateGuideAgainstPaper(parsed.data, pageCount);
  return issues.length
    ? { ok: false, guide: parsed.data, issues }
    : { ok: true, guide: parsed.data, issues: [] };
}

/** One issue per line, for terminals and the editor's error list. */
export function formatGuideIssues(issues: GuideIssue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join("\n");
}
