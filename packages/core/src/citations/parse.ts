import type { Citation } from "../schemas/citation";

/** `[p. 4]`, `[p.4]`, `[p. 4–5]`, `[p. 4-5]`, `[pp. 4–5]`; hyphen, en dash or em dash. */
const CITATION = /\[pp?\.\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\]/g;
const FENCED = /(```|~~~)[\s\S]*?(?:\1|$)/g;
const INLINE = /(`+)[^`]*?\1/g;

/** Character ranges [start, end) of Markdown code (fenced blocks and inline spans). */
export function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(FENCED)) ranges.push([m.index, m.index + m[0].length]);
  const inFenced = (i: number) => ranges.some(([a, b]) => i >= a && i < b);
  for (const m of text.matchAll(INLINE)) {
    if (!inFenced(m.index)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** Page citations in tutor output, in order, ignoring anything inside code (PRD §3.6). */
export function parseCitations(text: string): Citation[] {
  const code = codeRanges(text);
  const citations: Citation[] = [];
  for (const m of text.matchAll(CITATION)) {
    if (code.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const pageFrom = Number(m[1]);
    citations.push({ pageFrom, pageTo: m[2] ? Number(m[2]) : pageFrom, raw: m[0], index: m.index });
  }
  return citations;
}
