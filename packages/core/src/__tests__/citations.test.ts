import { describe, expect, it } from "vitest";
import { codeRanges, isValidCitation, parseCitations, validateCitations } from "../index";

const pages = (text: string) => parseCitations(text).map((c) => [c.pageFrom, c.pageTo]);

describe("parseCitations (PRD §3.6)", () => {
  it.each([
    ["See [p. 4].", [[4, 4]]],
    ["See [p.4].", [[4, 4]]],
    ["See [p. 4–5].", [[4, 5]]],
    ["See [p. 4-5].", [[4, 5]]],
    ["See [p. 4 — 5].", [[4, 5]]],
    ["See [pp. 12–14].", [[12, 14]]],
    [
      "A [p. 1] and B [p. 2–3].",
      [
        [1, 1],
        [2, 3],
      ],
    ],
  ])("%s", (text, expected) => {
    expect(pages(text)).toEqual(expected);
  });

  it.each(["[page 4]", "(p. 4)", "[p. ]", "[p. four]", "p. 4", "[P. 4]"])("ignores %s", (text) => {
    expect(parseCitations(text)).toEqual([]);
  });

  it("records raw text and offset", () => {
    expect(parseCitations("Claim [p. 4–5].")).toEqual([
      { pageFrom: 4, pageTo: 5, raw: "[p. 4–5]", index: 6 },
    ]);
  });

  it("ignores citations inside inline code and fenced blocks", () => {
    const text =
      "Real [p. 1]. Code `[p. 2]` and ``x [p. 3] y``.\n```\nconst s = '[p. 4]';\n```\nAfter [p. 5].";
    expect(pages(text)).toEqual([
      [1, 1],
      [5, 5],
    ]);
  });

  it("treats an unterminated fence as code until the end", () => {
    expect(pages("Before [p. 1]\n```\n[p. 2]")).toEqual([[1, 1]]);
  });

  it("codeRanges finds fenced and inline spans", () => {
    expect(codeRanges("a `b` c")).toEqual([[2, 5]]);
  });
});

describe("validateCitations (FR-4.9)", () => {
  it("keeps valid citations untouched", () => {
    const text = "Signifiers matter [p. 2]. Feedback too [p. 4–5].";
    const r = validateCitations(text, 7);
    expect(r.text).toBe(text);
    expect(r.valid).toHaveLength(2);
    expect(r.invalid).toEqual([]);
  });

  it("removes citations to non-existent pages but keeps the sentence", () => {
    const r = validateCitations("Claim one [p. 9]. Claim two [p. 2]. Claim three [p. 6–8].", 7);
    expect(r.text).toBe("Claim one. Claim two [p. 2]. Claim three.");
    expect(r.invalid.map((c) => c.raw)).toEqual(["[p. 9]", "[p. 6–8]"]);
    expect(r.valid).toEqual([{ pageFrom: 2, pageTo: 2, raw: "[p. 2]", index: 21 }]);
  });

  it("treats page 0 and reversed ranges as invalid", () => {
    expect(isValidCitation({ pageFrom: 0, pageTo: 0, raw: "", index: 0 }, 5)).toBe(false);
    expect(isValidCitation({ pageFrom: 4, pageTo: 2, raw: "", index: 0 }, 5)).toBe(false);
    expect(isValidCitation({ pageFrom: 5, pageTo: 5, raw: "", index: 0 }, 5)).toBe(true);
    expect(validateCitations("A [p. 4–2] B", 5).text).toBe("A B");
  });

  it("does not touch citation-like text inside code", () => {
    const text = "Use `[p. 99]` literally [p. 99].";
    expect(validateCitations(text, 7).text).toBe("Use `[p. 99]` literally.");
  });
});
