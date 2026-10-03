import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pagesFromDoclingDocument, doclingExtractor } from "../extractors/docling";
import { createExtractor } from "../extractors";
import { ExtractionError } from "../extractors/types";
import { itemsToText, metaFromInfo, unpdfExtractor } from "../extractors/unpdf";
import { normalizePages } from "../normalize";

const fixturePdf = (slug: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../../fixtures/papers/${slug}/source.pdf`, import.meta.url)),
  );

const item = (str: string, x: number, y: number, hasEOL = false, width = str.length * 5) => ({
  str,
  x,
  y,
  width,
  height: 10,
  fontSize: 10,
  fontFamily: "",
  dir: "ltr",
  hasEOL,
});

describe("unpdf extractor (FR-5.2)", () => {
  it("rebuilds lines, spaces and paragraph breaks from positioned items", () => {
    const text = itemsToText([
      item("Hello", 0, 700),
      item("world", 30, 700, true), // gap of 5 → space
      item("", 0, 0, true), // empty EOL marker
      item("next", 0, 686), // one line down
      item("line", 20, 686), // no gap → joined
      item("New", 0, 650), // ~3.6 lines down → paragraph
      item("paragraph", 20, 650),
    ]);
    expect(text).toBe("Hello world\nnextline\n\nNew paragraph");
  });

  it("reads title and authors from PDF metadata", () => {
    expect(metaFromInfo({ Title: "Visible Cues", Author: "A. Fixture; B. Synthetic" })).toEqual({
      title: "Visible Cues",
      authors: ["A. Fixture", "B. Synthetic"],
    });
    expect(metaFromInfo({ Title: "paper_final.pdf", Author: "" })).toEqual({ authors: [] });
    expect(metaFromInfo({ Author: "Ann Lee and Bo Kim" }).authors).toEqual(["Ann Lee", "Bo Kim"]);
  });

  it("extracts every page of the visible-cues fixture PDF", async () => {
    const expected = JSON.parse(
      readFileSync(
        new URL("../../../../fixtures/papers/visible-cues/pages.json", import.meta.url),
        "utf8",
      ),
    ) as { title: string; pages: { n: number; text: string }[] };
    const pdf = fixturePdf("visible-cues");
    const { pages: raw, meta } = await unpdfExtractor().extract(pdf);
    expect(pdf.byteLength).toBeGreaterThan(0); // the caller's buffer is not detached
    expect(meta.title).toBe(expected.title);
    const pages = normalizePages(raw);
    expect(pages.map((p) => p.n)).toEqual(expected.pages.map((p) => p.n));
    for (const [i, page] of pages.entries()) {
      // Running header and page-number footer are gone; the body is intact.
      expect(page.text).not.toMatch(/UXie synthetic test paper|^Page \d+$/m);
      const firstWords = expected.pages[i]!.text.split(/\s+/).slice(0, 8).join(" ");
      expect(page.text.replace(/\s+/g, " ")).toContain(firstWords);
    }
  });

  it("throws ExtractionError for bytes that are not a PDF", async () => {
    const bad = new TextEncoder().encode("not a pdf at all");
    await expect(unpdfExtractor().extract(bad)).rejects.toBeInstanceOf(ExtractionError);
  });
});

const doclingDoc = {
  name: "source",
  body: {
    self_ref: "#/body",
    children: [
      { $ref: "#/texts/0" },
      { $ref: "#/texts/1" },
      { $ref: "#/groups/0" },
      { $ref: "#/tables/0" },
    ],
  },
  groups: [{ self_ref: "#/groups/0", children: [{ $ref: "#/texts/2" }, { $ref: "#/texts/3" }] }],
  texts: [
    { label: "page_header", text: "Journal header", prov: [{ page_no: 1 }] },
    { label: "title", text: "A Paper", prov: [{ page_no: 1 }] },
    { label: "list_item", text: "first point", prov: [{ page_no: 1 }] },
    { label: "text", text: "Second page text", prov: [{ page_no: 2 }] },
  ],
  tables: [
    {
      label: "table",
      prov: [{ page_no: 2 }],
      data: { grid: [[{ text: "N" }, { text: "24" }]] },
    },
  ],
  pages: { "1": { page_no: 1 }, "2": { page_no: 2 }, "3": { page_no: 3 } },
};

describe("docling extractor (FR-5.5, behind EXTRACTOR=docling)", () => {
  it("rebuilds page text in reading order, skipping running headers", () => {
    expect(pagesFromDoclingDocument(doclingDoc as never)).toEqual([
      { n: 1, text: "A Paper\nfirst point" },
      { n: 2, text: "Second page text\nN | 24" },
      { n: 3, text: "" }, // declared page without text (figure-only)
    ]);
  });

  it("posts the PDF to docling-serve and parses the JSON document", async () => {
    let request: { url: string; body: FormData } | undefined;
    const fetch = (async (url: URL, init: RequestInit) => {
      request = { url: String(url), body: init.body as FormData };
      return Response.json({
        status: "success",
        errors: [],
        document: { json_content: doclingDoc },
      });
    }) as unknown as typeof globalThis.fetch;
    const ex = createExtractor("docling", { doclingUrl: "http://uxie-docling:5001", fetch });
    expect(ex.name).toBe("docling");
    const res = await ex.extract(new Uint8Array([37, 80, 68, 70]));
    expect(request!.url).toBe("http://uxie-docling:5001/v1/convert/file");
    expect(request!.body.get("to_formats")).toBe("json");
    expect(request!.body.get("files")).toBeInstanceOf(Blob);
    expect(res.pages).toHaveLength(3);
  });

  it.each([
    ["HTTP error", () => new Response("boom", { status: 500 }), /HTTP 500/],
    [
      "conversion failure",
      () => Response.json({ status: "failure", errors: ["bad"], document: {} }),
      /could not convert/,
    ],
    ["unexpected body", () => Response.json({ nope: true }), /unexpected response/],
  ])("maps %s to ExtractionError", async (_, respond, message) => {
    const fetch = (async () => respond()) as unknown as typeof globalThis.fetch;
    const ex = doclingExtractor({ url: "http://docling", fetch });
    await expect(ex.extract(new Uint8Array([1]))).rejects.toThrow(message);
  });

  it("maps network failures to ExtractionError and requires DOCLING_URL", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    await expect(
      doclingExtractor({ url: "http://docling", fetch }).extract(new Uint8Array([1])),
    ).rejects.toThrow(/unreachable/);
    expect(() => createExtractor("docling")).toThrow(/DOCLING_URL/);
    expect(createExtractor("unpdf").name).toBe("unpdf");
  });
});
