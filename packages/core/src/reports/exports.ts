import { z } from "zod";

/** Conversation export (FR-7.3): one row per message. Never emails or auth ids. */

export const EXPORT_COLUMNS = [
  "pseudonym_id",
  "conversation_id",
  "module_id_at_start",
  "module_title_at_start",
  "paper_id",
  "paper_slug",
  "paper_version_id",
  "version_no",
  "message_id",
  "created_at",
  "role",
  "mode",
  "event",
  "help_level",
  "content",
  "provider",
  "model",
  "prompt_version",
  "generation",
  "feedback_rating",
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export interface ExportRow {
  pseudonym_id: string;
  conversation_id: string;
  module_id_at_start: string;
  module_title_at_start: string;
  paper_id: string;
  paper_slug: string;
  paper_version_id: string;
  version_no: number;
  message_id: string;
  /** ISO 8601 UTC. */
  created_at: string;
  role: "student" | "tutor" | "event";
  mode: string | null;
  event: string | null;
  help_level: string | null;
  content: string;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  generation: Record<string, unknown> | null;
  feedback_rating: 1 | -1 | null;
}

const isoDate = z.iso.date();
/** Postgres `uuid` shape, any version/variant (seeded ids are not RFC 4122). */
export const PgUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be an id");

/** Filters shared by the admin export, the CLI and the review list. All optional. */
export const ExportFiltersSchema = z
  .object({
    moduleId: PgUuid.optional(),
    paperId: PgUuid.optional(),
    versionId: PgUuid.optional(),
    /** Inclusive day range on the conversation start (UTC). */
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict();
export type ExportFilters = z.infer<typeof ExportFiltersSchema>;

export const ExportFormat = z.enum(["csv", "json"]);
export type ExportFormat = z.infer<typeof ExportFormat>;

/** `uxie-export-2026-10-04.csv`, `uxie-research-export-2026-10-04.json`. */
export const exportFilename = (format: ExportFormat, researchOnly: boolean, now = new Date()) =>
  `uxie-${researchOnly ? "research-" : ""}export-${now.toISOString().slice(0, 10)}.${format}`;
