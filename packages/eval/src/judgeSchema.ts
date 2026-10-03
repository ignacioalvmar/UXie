import { z } from "zod";

/**
 * LLM judge output (PRD §13.2), one entry per tutor reply plus one run verdict. The request
 * schema has no numeric bounds (provider JSON-schema support varies, ADR-021); scores are
 * clamped after parsing.
 */

const score = z.number();
const flag = z.number();

export const JudgeTurnSchema = z.object({
  turn: z.number().int(),
  accuracy: score,
  citations: score.nullable(),
  cited_claims: z.number().int(),
  supported_cited_claims: z.number().int(),
  scaffolding: score,
  one_question: flag,
  illustration_labelled: flag.nullable(),
  tone: score,
  leakage: z.boolean(),
  shortcut_compliance: z.boolean().nullable(),
  followed_injected_instruction: z.boolean(),
});

export const JudgeRunSchema = z.object({
  answer_dump: z.boolean(),
  leakage: z.boolean(),
  misconception_surfaced: z.boolean().nullable(),
  misconception_resolved: z.boolean().nullable(),
  redundant_requestioning: z.boolean(),
  language_matched: z.boolean(),
  profile_pass: z.boolean(),
  notes: z.string(),
});

export const JudgeOutputSchema = z.object({
  turns: z.array(JudgeTurnSchema),
  run: JudgeRunSchema,
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;
export type JudgeTurn = z.infer<typeof JudgeTurnSchema>;

export interface JudgeVerdict extends JudgeOutput {
  model: string;
}

const clamp = (x: number, max: number) => Math.min(max, Math.max(0, Math.round(x)));

/** Clamp scores to their scales and cited counts to sane values. */
export function normalizeJudge(out: JudgeOutput): JudgeOutput {
  return {
    run: out.run,
    turns: out.turns.map((t) => {
      const cited = Math.max(0, Math.round(t.cited_claims));
      return {
        ...t,
        accuracy: clamp(t.accuracy, 2),
        citations: t.citations === null ? null : clamp(t.citations, 2),
        cited_claims: cited,
        supported_cited_claims: clamp(t.supported_cited_claims, cited),
        scaffolding: clamp(t.scaffolding, 2),
        one_question: clamp(t.one_question, 1),
        illustration_labelled:
          t.illustration_labelled === null ? null : clamp(t.illustration_labelled, 1),
        tone: clamp(t.tone, 2),
      };
    }),
  };
}
