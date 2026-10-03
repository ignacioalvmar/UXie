import { estimateTokens, type ExtractionWarning, type Page } from "@uxie/core";

/** Pages with less text than this are probably scanned or figure-only (FR-5.3). */
export const MIN_PAGE_CHARS = 200;

const REFERENCES_HEADING =
  /^(?:[\dIVX]+\.?\s+)?(references|bibliography|works cited|literature cited|literatur(?:verzeichnis)?|quellen(?:verzeichnis)?)\s*:?$/i;

export interface Analysis {
  pageCount: number;
  tokenEstimate: number;
  referencesStartPage: number | null;
  warnings: ExtractionWarning[];
}

/** Last page with a references heading; the section sits at the end, appendices may follow. */
export function findReferencesStart(pages: readonly Page[]): number | null {
  for (let i = pages.length - 1; i >= 0; i--) {
    if (pages[i]!.text.split("\n").some((l) => REFERENCES_HEADING.test(l.trim())))
      return pages[i]!.n;
  }
  return null;
}

/** FR-5.3: page count, token estimate, scanned/figure-only pages, references section. */
export function analyzePages(pages: readonly Page[], opts: { tokenWarn: number }): Analysis {
  const tokenEstimate = pages.reduce((sum, p) => sum + estimateTokens(p.text), 0);
  const warnings: ExtractionWarning[] = [];
  for (const p of pages) {
    const chars = p.text.replace(/\s/g, "").length;
    if (chars < MIN_PAGE_CHARS) {
      warnings.push({
        kind: "scanned_or_figure_only",
        page: p.n,
        message: `Page ${p.n} has ${chars === 0 ? "no" : "very little"} extractable text (${chars} characters); it may be scanned or figure-only, so UXie cannot read it.`,
      });
    }
  }
  if (tokenEstimate > opts.tokenWarn) {
    warnings.push({
      kind: "token_count_high",
      message: `The paper is about ${tokenEstimate.toLocaleString("en")} tokens (warning above ${opts.tokenWarn.toLocaleString("en")}); turns will cost more and may use page retrieval.`,
    });
  }
  const referencesStartPage = findReferencesStart(pages);
  if (referencesStartPage !== null) {
    warnings.push({
      kind: "references_start",
      page: referencesStartPage,
      message: `References start on page ${referencesStartPage}.`,
    });
  }
  return { pageCount: pages.length, tokenEstimate, referencesStartPage, warnings };
}
