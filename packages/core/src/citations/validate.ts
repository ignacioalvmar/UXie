import type { Citation } from "../schemas/citation";
import { parseCitations } from "./parse";

export interface CitationValidation {
  /** Text with invalid citations removed; the surrounding sentence is kept. */
  text: string;
  /** Valid citations, with offsets into the returned `text`. */
  valid: Citation[];
  /** Removed citations, with offsets into the original text. */
  invalid: Citation[];
}

export function isValidCitation(c: Citation, pageCount: number): boolean {
  return c.pageFrom >= 1 && c.pageTo >= c.pageFrom && c.pageTo <= pageCount;
}

/**
 * Remove citations to pages that do not exist (FR-4.9). "Claim [p. 99]." becomes "Claim.".
 * Invalid citations are returned so the caller can count them (`llm_calls.meta.citation_invalid`).
 */
export function validateCitations(text: string, pageCount: number): CitationValidation {
  const all = parseCitations(text);
  const invalid = all.filter((c) => !isValidCitation(c, pageCount));
  let out = text;
  for (const c of [...invalid].reverse()) {
    let start = c.index;
    while (start > 0 && (out[start - 1] === " " || out[start - 1] === "\t")) start--;
    out = out.slice(0, start) + out.slice(c.index + c.raw.length);
  }
  return { text: out, valid: invalid.length ? parseCitations(out) : all, invalid };
}
