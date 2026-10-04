import { parseCitations } from "@uxie/core";

/**
 * Text helpers for tutor messages (workspace handoff §4.2). Pure and browser-safe. Messages are
 * Markdown; these transforms only add Markdown (links, bold), never HTML, so rendering stays
 * `skipHtml` (NFR-9).
 */

const ILLUSTRATION = /^\s*💡\s*Illustrative example:\s*/u;

export interface Segment {
  kind: "text" | "illustration";
  markdown: string;
}

/** Split into Markdown segments; a paragraph starting `💡 Illustrative example:` is its own block. */
export function splitIllustrations(markdown: string): Segment[] {
  const out: Segment[] = [];
  for (const para of markdown.split(/\n{2,}/)) {
    if (!para.trim()) continue;
    if (ILLUSTRATION.test(para)) {
      out.push({ kind: "illustration", markdown: para.replace(ILLUSTRATION, "") });
    } else if (out.at(-1)?.kind === "text") {
      out.at(-1)!.markdown += `\n\n${para}`;
    } else {
      out.push({ kind: "text", markdown: para });
    }
  }
  return out;
}

/** `[p. 4]` → `[p. 4](#cite-4-4)`: a link the renderer turns into a citation chip. */
export function linkCitations(markdown: string): string {
  const cites = parseCitations(markdown);
  let out = "";
  let last = 0;
  for (const c of cites) {
    const end = c.index + c.raw.length;
    // Already a link (`[p. 4](…)`) or a reference definition: leave it.
    if (markdown[end] === "(" || markdown[end] === ":") continue;
    out += markdown.slice(last, c.index) + `${c.raw}(#cite-${c.pageFrom}-${c.pageTo})`;
    last = end;
  }
  return out + markdown.slice(last);
}

export function parseCiteHref(href: string | undefined): { from: number; to: number } | null {
  const m = /^#cite-(\d+)-(\d+)$/.exec(href ?? "");
  return m ? { from: Number(m[1]), to: Number(m[2]) } : null;
}

const SENTENCE_END = /[.!?…](?=\s|$)/g;

/**
 * Bold the question that ends the turn (handoff §4.2: "the current question is unmistakable"):
 * the last sentence ending in "?" in the last paragraph, unless it is already emphasised.
 */
export function boldFinalQuestion(markdown: string): string {
  const paras = markdown.split(/(\n{2,})/);
  for (let i = paras.length - 1; i >= 0; i--) {
    const para = paras[i]!;
    if (!para.trim() || /^\n+$/.test(para)) continue;
    const q = para.lastIndexOf("?");
    if (
      q < 0 ||
      para
        .slice(q + 1)
        .trim()
        .replace(/[*_)\]]/g, "").length > 0
    )
      return markdown;
    // Start of the question: after the previous sentence end, a line break or a list marker.
    let start = 0;
    for (const m of para.slice(0, q).matchAll(SENTENCE_END)) start = m.index + 1;
    const nl = para.lastIndexOf("\n", q);
    if (nl + 1 > start) start = nl + 1;
    const lead = /^\s*(?:[-*+]\s+|\d+\.\s+|>\s*)?/.exec(para.slice(start))![0];
    start += lead.length;
    const question = para.slice(start, q + 1);
    if (!question.trim() || /\*\*|__/.test(question)) return markdown;
    paras[i] = `${para.slice(0, start)}**${question.trim()}**${para.slice(q + 1)}`;
    return paras.join("");
  }
  return markdown;
}

/** Plain text of a tutor message's last question, for "Pip asked: …" (library handoff §2.2). */
export function lastQuestion(markdown: string, maxLength = 160): string {
  const plain = markdown
    .replace(/\[pp?\.\s*\d+(?:\s*[-–—]\s*\d+)?\]/g, "")
    .replace(/💡\s*Illustrative example:/gu, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.match(/[^.!?…]+[.!?…]+/g) ?? [plain];
  const pick =
    [...sentences].reverse().find((s) => s.trim().endsWith("?")) ?? sentences.at(-1) ?? "";
  const text = pick.trim().replace(/\s+([.!?,;:])/g, "$1");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
