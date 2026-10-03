import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  BaseEnvSchema,
  PagesFileSchema,
  TeachingGuideSchema,
  llmSettingsFromEnv,
  parseEnv,
  validateGuide,
} from "@uxie/core";
import { createGateway, defaultMockResponder, LlmError, type MockResponder } from "@uxie/llm";
import { unpdfExtractor } from "../extractors/unpdf";
import { loadGuidePrompts } from "../guideDraft";
import { ingestPdf, resolveTitle, runIngestJob, type IngestStore } from "../pipeline";

const papersDir = new URL("../../../../fixtures/papers/", import.meta.url);
const prompts = loadGuidePrompts(fileURLToPath(new URL("../../../../prompts/", import.meta.url)));

function mockLlm(responder: MockResponder = defaultMockResponder) {
  const env = parseEnv(BaseEnvSchema, { LLM_PROVIDER: "mock" });
  return createGateway(llmSettingsFromEnv(env), { mockResponder: responder });
}

/** Every fixture paper that ships a source PDF. */
const fixtureSlugs = readdirSync(papersDir).filter((slug) =>
  existsSync(new URL(`${slug}/source.pdf`, papersDir)),
);

describe("M3 acceptance: ingest each fixture PDF (FR-5.2–5.4, FR-5.6)", () => {
  it("has the expected fixture PDFs", () => {
    expect(fixtureSlugs).toEqual(expect.arrayContaining(["visible-cues", "scanned-page"]));
  });

  it.each(fixtureSlugs)(
    "%s: pages.json with the right page count and a schema-valid guide",
    async (slug) => {
      const pdf = new Uint8Array(readFileSync(new URL(`${slug}/source.pdf`, papersDir)));
      const steps: string[] = [];
      const r = await ingestPdf(pdf, {
        extractor: unpdfExtractor(),
        tokenWarn: 60_000,
        guide: { llm: mockLlm(), prompts },
        onStep: (s) => void steps.push(s),
      });
      expect(steps).toEqual(["extract", "analyze", "draft_guide"]);
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(PagesFileSchema.safeParse(r.pagesFile).success).toBe(true);

      const committed = new URL(`${slug}/pages.json`, papersDir);
      if (existsSync(committed)) {
        const expected = PagesFileSchema.parse(JSON.parse(readFileSync(committed, "utf8")));
        expect(r.analysis.pageCount).toBe(expected.pages.length);
        expect(r.pagesFile.title).toBe(expected.title);
      }
      expect(r.guide?.ok).toBe(true);
      expect(validateGuide(r.guide!.guide, r.analysis.pageCount).ok).toBe(true);
    },
  );

  it("warns about the figure-only page of the scanned-page fixture", async () => {
    const pdf = new Uint8Array(readFileSync(new URL("scanned-page/source.pdf", papersDir)));
    const r = await ingestPdf(pdf, { extractor: unpdfExtractor(), tokenWarn: 60_000 });
    expect(r.analysis.pageCount).toBe(4);
    expect(r.guide).toBeNull();
    expect(r.analysis.warnings.filter((w) => w.kind === "scanned_or_figure_only")).toEqual([
      expect.objectContaining({ page: 3 }),
    ]);
    expect(r.analysis.referencesStartPage).toBe(4);
  });

  it("committed fixture guides are approved-quality (schema + page refs)", () => {
    for (const slug of fixtureSlugs) {
      const guideFile = new URL(`${slug}/guide.yaml`, papersDir);
      if (!existsSync(guideFile)) continue;
      const pages = PagesFileSchema.parse(
        JSON.parse(readFileSync(new URL(`${slug}/pages.json`, papersDir), "utf8")),
      );
      const v = validateGuide(parseYaml(readFileSync(guideFile, "utf8")), pages.pages.length);
      expect(v.issues, slug).toEqual([]);
    }
  });
});

class MemoryStore implements IngestStore {
  log: string[] = [];
  saved: Record<string, unknown> = {};
  constructor(
    private pdf: Uint8Array,
    private title?: string,
  ) {}
  async loadSource() {
    return { pdf: this.pdf, title: this.title };
  }
  async setStep(_: string, step: string) {
    this.log.push(`step:${step}`);
  }
  async saveExtraction(_: string, e: Parameters<IngestStore["saveExtraction"]>[1]) {
    this.log.push("extraction");
    this.saved.extraction = e;
  }
  async saveGuideDraft(_: string, d: Parameters<IngestStore["saveGuideDraft"]>[1]) {
    this.log.push("guide");
    this.saved.guide = d;
  }
  async markReady() {
    this.log.push("ready");
  }
  async markFailed(_: string, error: string) {
    this.log.push(`failed:${error}`);
  }
}

const fixturePdf = () =>
  new Uint8Array(readFileSync(new URL("visible-cues/source.pdf", papersDir)));

describe("runIngestJob (FR-5.1 step 4)", () => {
  it("stores pages, warnings and the guide draft, then marks the version ready", async () => {
    const store = new MemoryStore(fixturePdf(), "Instructor title");
    const out = await runIngestJob("v1", {
      store,
      extractor: unpdfExtractor(),
      tokenWarn: 60_000,
      guide: { llm: mockLlm(), prompts },
    });
    expect(out.status).toBe("ready");
    expect(store.log).toEqual([
      "step:extract",
      "step:analyze",
      "step:draft_guide",
      "extraction",
      "guide",
      "ready",
    ]);
    expect(store.saved.extraction).toMatchObject({ extractor: "unpdf", pageCount: 7 });
    const guide = store.saved.guide as { guide: unknown; issues: unknown[]; promptVersion: string };
    expect(TeachingGuideSchema.safeParse(guide.guide).success).toBe(true);
    expect(guide.issues).toEqual([]);
    expect(guide.promptVersion).toBe(prompts.version);
    if (out.status === "ready") expect(out.result.pagesFile.title).toBe("Instructor title");
  });

  it("FR-5.4 invalid draft → repair retry → still-invalid draft saved with the errors listed", async () => {
    const llm = mockLlm((c) =>
      c.purpose === "guide_draft"
        ? JSON.stringify({ title: "Only a title" })
        : defaultMockResponder(c),
    );
    const store = new MemoryStore(fixturePdf());
    const out = await runIngestJob("v1", {
      store,
      extractor: unpdfExtractor(),
      tokenWarn: 60_000,
      guide: { llm, prompts },
    });
    // Extraction succeeded, so the version is ready even though the guide needs work.
    expect(out.status).toBe("ready");
    expect(store.log.slice(-2)).toEqual(["guide", "ready"]);
    const saved = store.saved.guide as { guide: unknown; issues: { path: string }[] };
    expect(saved.issues.length).toBeGreaterThan(0);
    expect(saved.issues[0]!.path).toBe("(output)");
  });

  it("saves a shape-valid but rule-breaking draft as is, with its issues", async () => {
    const llm = mockLlm((c) => {
      if (c.purpose !== "guide_draft") return defaultMockResponder(c);
      const g = JSON.parse(defaultMockResponder(c) as string);
      g.objectives[0].refs = [{ page: 42 }];
      return JSON.stringify(g);
    });
    const store = new MemoryStore(fixturePdf());
    const out = await runIngestJob("v1", {
      store,
      extractor: unpdfExtractor(),
      tokenWarn: 60_000,
      guide: { llm, prompts },
    });
    expect(out.status).toBe("ready");
    const saved = store.saved.guide as {
      guide: { objectives: { refs: unknown }[] };
      issues: { path: string; message: string }[];
    };
    expect(saved.guide.objectives[0]!.refs).toEqual([{ page: 42 }]);
    expect(saved.issues).toEqual([
      { path: "objectives[0].refs[0].page", message: "page 42 does not exist (paper has 7 pages)" },
    ]);
  });

  it("records a provider failure as a guide issue without failing the version", async () => {
    const llm = mockLlm(() => ({
      text: "",
      error: new LlmError("auth_failed", "The provider rejected the API key"),
    }));
    const r = await ingestPdf(fixturePdf(), {
      extractor: unpdfExtractor(),
      tokenWarn: 60_000,
      guide: { llm, prompts },
    });
    expect(r.guide).toMatchObject({ ok: false, draft: null });
    expect(r.guide!.issues[0]!.message).toContain("auth_failed");
  });

  it("FR-5.5 a PDF without any text marks the version failed with a hint", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    const store = new MemoryStore(await doc.save());
    const out = await runIngestJob("v1", { store, extractor: unpdfExtractor(), tokenWarn: 60_000 });
    expect(out.status).toBe("failed");
    expect(store.log.at(-1)).toMatch(/^failed:.*EXTRACTOR=docling/);
    expect(store.log).not.toContain("ready");
  });

  it("rethrows infrastructure errors so the worker can re-queue the job", async () => {
    const store = new MemoryStore(fixturePdf());
    store.loadSource = async () => {
      throw new Error("storage down");
    };
    await expect(
      runIngestJob("v1", { store, extractor: unpdfExtractor(), tokenWarn: 1 }),
    ).rejects.toThrow("storage down");
  });

  it("resolves the title from override, metadata, then the first line", () => {
    const pages = [{ n: 1, text: "\nA Study of Things\nAuthors" }];
    expect(resolveTitle({ authors: [] }, pages, "Given")).toBe("Given");
    expect(resolveTitle({ title: "Meta", authors: [] }, pages)).toBe("Meta");
    expect(resolveTitle({ authors: [] }, pages)).toBe("A Study of Things");
    expect(resolveTitle({ authors: [] }, [{ n: 1, text: "" }])).toBe("Untitled paper");
  });
});
