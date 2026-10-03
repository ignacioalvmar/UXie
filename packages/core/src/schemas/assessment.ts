import { z } from "zod";

/** Output of the assessment LLM call (PRD §3.5, §8.1, prompts/assess.md). */
export const AssessmentSchema = z.object({
  intent: z.enum(["answer", "question", "shortcut_request", "off_topic", "meta", "greeting"]),
  answer_quality: z.enum(["correct", "partial", "incorrect", "none"]),
  objective_updates: z
    .array(
      z.object({
        objective_id: z.string(),
        status: z.enum(["in_progress", "demonstrated"]),
        evidence: z.string().max(300),
      }),
    )
    .max(3),
  misconception: z.object({ objective_id: z.string(), text: z.string().max(200) }).nullable(),
  /** Text of a previously seen misconception that is now resolved. */
  misconception_resolved: z.string().nullable(),
  /** ISO 639-1 code (optionally with region) of the student's message. */
  language: z.string().min(2).max(5),
});
export type Assessment = z.infer<typeof AssessmentSchema>;
