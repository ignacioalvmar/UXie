import type { Page } from "@uxie/core";
import type { RawPage } from "./extractors/types";

const cp = (code: number) => String.fromCodePoint(code);

/** Typographic ligatures (U+FB00–FB06) as plain letters. */
const LIGATURES = new Map(
  (["ff", "fi", "fl", "ffi", "ffl", "st", "st"] as const).map((v, i) => [cp(0xfb00 + i), v]),
);
const LIGATURE = new RegExp(`[${cp(0xfb00)}-${cp(0xfb06)}]`, "g");
const SOFT_HYPHEN = new RegExp(cp(0xad), "g");

/** Lines at the top and bottom of a page that may be running headers or footers. */
const EDGE_LINES = 3;

export function normalizeLine(line: string): string {
  return line
    .replace(LIGATURE, (c) => LIGATURES.get(c) ?? c)
    .replace(SOFT_HYPHEN, "")
    .replace(/\s/g, " ") // tabs, no-break and other Unicode spaces
    .replace(/\p{Cc}/gu, "") // remaining control characters
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Running headers/footers often differ only in the page number. */
const edgeKey = (line: string) => line.toLowerCase().replace(/\d+/g, "#");

function edgeIndexes(lines: string[]): number[] {
  const nonEmpty = lines.flatMap((l, i) => (l ? [i] : []));
  return [...new Set([...nonEmpty.slice(0, EDGE_LINES), ...nonEmpty.slice(-EDGE_LINES)])];
}

/**
 * Drop lines that repeat in the header/footer zone of at least half the pages (FR-5.2). Only the
 * first and last few lines of a page are candidates, so a phrase repeated in body text survives.
 * Needs ≥ 3 pages; with fewer, "half the pages" cannot tell a header from content.
 */
export function removeRunningHeaders(pages: string[][]): string[][] {
  if (pages.length < 3) return pages;
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const keys = new Set(edgeIndexes(lines).map((i) => edgeKey(lines[i]!)));
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return pages.map((lines) => {
    const drop = new Set(
      edgeIndexes(lines).filter((i) => (counts.get(edgeKey(lines[i]!)) ?? 0) >= threshold),
    );
    return lines.filter((_, i) => !drop.has(i));
  });
}

/** Join words split across a line break: "affor-\ndance" → "affordance" (lowercase continuation only). */
export function dehyphenate(text: string): string {
  return text.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2");
}

/** FR-5.2: whitespace, ligatures, running headers/footers, line-break hyphenation. */
export function normalizePages(raw: readonly RawPage[]): Page[] {
  const lined = raw.map((p) => p.text.replace(/\r\n?/g, "\n").split("\n").map(normalizeLine));
  return removeRunningHeaders(lined).map((lines, i) => ({
    n: raw[i]!.n,
    text: dehyphenate(lines.join("\n"))
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  }));
}
