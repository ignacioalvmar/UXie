import { z } from "zod";

/** A page citation in tutor output, e.g. `[p. 4]` or `[p. 4–5]` (PRD §3.6). */
export const CitationSchema = z.object({
  pageFrom: z.number().int(),
  pageTo: z.number().int(),
  /** The citation exactly as written. */
  raw: z.string(),
  /** Character offset of `raw` in the text it was parsed from. */
  index: z.number().int(),
});
export type Citation = z.infer<typeof CitationSchema>;
