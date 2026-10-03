import { z } from "zod";

/** Learner state (PRD §3.4, §8.1). Stored as JSONB `conversations.state`. */

export const ObjectiveStatus = z.enum(["not_started", "in_progress", "demonstrated"]);
export type ObjectiveStatus = z.infer<typeof ObjectiveStatus>;

export const Mode = z.enum(["understand", "apply", "critique", "build"]);
export type Mode = z.infer<typeof Mode>;

export const HelpLevel = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ask") }),
  z.object({ kind: z.literal("hint"), index: z.number().int().min(0) }),
  z.object({ kind: z.literal("explain") }),
  z.object({ kind: z.literal("check") }),
]);
export type HelpLevel = z.infer<typeof HelpLevel>;

export const MisconceptionSeen = z.object({
  objective: z.string(),
  text: z.string().max(200),
  resolved: z.boolean(),
});
export type MisconceptionSeen = z.infer<typeof MisconceptionSeen>;

export const LearnerStateSchema = z.object({
  schema_version: z.literal(1),
  mode: Mode,
  /** null when all objectives relevant to the mode are demonstrated (or the mode has none). */
  active_objective: z.string().nullable(),
  active_question_index: z.number().int().min(0),
  attempts: z.number().int().min(0),
  stuck_requests: z.number().int().min(0),
  last_help_level: HelpLevel,
  objectives: z.record(z.string(), ObjectiveStatus),
  evidence: z.record(z.string(), z.string().max(300)),
  misconceptions_seen: z.array(MisconceptionSeen).max(20),
  history_summary: z.string().max(2000).default(""),
  summarized_through_message_id: z.uuid().nullable(),
  language: z.string().default("en"),
});
export type LearnerState = z.infer<typeof LearnerStateSchema>;
