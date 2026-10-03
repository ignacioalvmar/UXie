import { describe, expect, it } from "vitest";
import { analyzePages, findReferencesStart } from "../analyze";
import { dehyphenate, normalizeLine, normalizePages, removeRunningHeaders } from "../normalize";

const body = (n: number) =>
  `Body paragraph ${n} with enough words to be clearly content and not a running header at all.`;

describe("FR-5.2 normalization", () => {
  it("normalizes whitespace, ligatures, soft hyphens and control characters", () => {
    expect(normalizeLine("  the ﬁrst\t\tﬂow  of af­fordances\u0007 ")).toBe(
      "the first flow of affordances",
    );
  });

  it("de-hyphenates words split across lines, only before a lowercase continuation", () => {
    expect(dehyphenate("affor-\ndances matter")).toBe("affordances matter");
    expect(dehyphenate("Über-\nraschung")).toBe("Überraschung");
    expect(dehyphenate("within-\nSubjects")).toBe("within-\nSubjects");
    expect(dehyphenate("ends with -\nnext")).toBe("ends with -\nnext");
  });

  it("drops lines repeated in the header/footer zone of at least half the pages", () => {
    const pages = [1, 2, 3, 4].map((n) => [
      "Journal of Synthetic HCI, 2026",
      body(n),
      body(n + 10),
      `Shared closing sentence that appears on every page body.`,
      body(n + 20),
      body(n + 30),
      `Page ${n}`,
    ]);
    const out = removeRunningHeaders(pages);
    for (const lines of out) {
      expect(lines).not.toContain("Journal of Synthetic HCI, 2026");
      expect(lines.some((l) => /^Page \d$/.test(l))).toBe(false);
    }
    // Repeated text in the middle of a page is content, not a header.
    expect(out[0]).toContain("Shared closing sentence that appears on every page body.");
  });

  it("keeps edge lines that repeat on fewer than half the pages", () => {
    const pages = [1, 2, 3, 4, 5].map((n) => [
      n <= 2 ? "Section 1" : `Topic ${"abcde"[n - 1]}`,
      body(n),
    ]);
    const out = removeRunningHeaders(pages);
    expect(out[0]![0]).toBe("Section 1");
    expect(out[4]![0]).toBe("Topic e");
  });

  it("does not remove anything from papers with fewer than 3 pages", () => {
    const pages = [
      ["Same header", body(1)],
      ["Same header", body(2)],
    ];
    expect(removeRunningHeaders(pages)).toEqual(pages);
  });

  it("normalizePages keeps page numbers and collapses blank lines", () => {
    const pages = normalizePages([
      { n: 1, text: "Title\r\n\r\n\r\n\r\nAbstract  text" },
      { n: 2, text: "" },
    ]);
    expect(pages).toEqual([
      { n: 1, text: "Title\n\nAbstract text" },
      { n: 2, text: "" },
    ]);
  });
});

describe("FR-5.3 analysis", () => {
  const long = "x".repeat(400);

  it("warns about pages with little or no text", () => {
    const a = analyzePages(
      [
        { n: 1, text: long },
        { n: 2, text: "Figure 2." },
        { n: 3, text: "   " },
      ],
      { tokenWarn: 60_000 },
    );
    expect(a.pageCount).toBe(3);
    expect(a.warnings.map((w) => [w.kind, w.page])).toEqual([
      ["scanned_or_figure_only", 2],
      ["scanned_or_figure_only", 3],
    ]);
    expect(a.warnings[1]!.message).toContain("no extractable text");
  });

  it("estimates tokens and warns above PAPER_TOKEN_WARN", () => {
    const a = analyzePages([{ n: 1, text: long }], { tokenWarn: 50 });
    expect(a.tokenEstimate).toBe(100);
    expect(a.warnings).toContainEqual(expect.objectContaining({ kind: "token_count_high" }));
    expect(analyzePages([{ n: 1, text: long }], { tokenWarn: 100 }).warnings).toEqual([]);
  });

  it("finds the references section start (last heading wins)", () => {
    const pages = [
      { n: 1, text: `Contents\nReferences\n${long}` },
      { n: 2, text: long },
      { n: 3, text: `${long}\n7 References\n[1] A.` },
      { n: 4, text: `Appendix A\n${long}` },
    ];
    expect(findReferencesStart(pages)).toBe(3);
    expect(findReferencesStart([{ n: 1, text: `Literaturverzeichnis\n${long}` }])).toBe(1);
    expect(findReferencesStart([{ n: 1, text: `We list references below.\n${long}` }])).toBeNull();
    const a = analyzePages(pages, { tokenWarn: 60_000 });
    expect(a.referencesStartPage).toBe(3);
    expect(a.warnings).toContainEqual({
      kind: "references_start",
      page: 3,
      message: "References start on page 3.",
    });
  });
});
