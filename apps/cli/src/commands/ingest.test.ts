import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { PagesFileSchema, validateGuide } from "@uxie/core";
import { defaultMockResponder } from "@uxie/llm";
import { ingestCommand } from "./ingest";

const pdf = fileURLToPath(
  new URL("../../../../fixtures/papers/scanned-page/source.pdf", import.meta.url),
);
const env = { LLM_PROVIDER: "mock" };
const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "uxie-ingest-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("FR-5.6 pnpm uxie ingest --local", () => {
  it("writes source.pdf, pages.json and a valid guide.yaml", async () => {
    const out = tempDir();
    const lines: string[] = [];
    await ingestCommand(
      pdf,
      { paper: "scanned-page", local: true, out },
      { env, log: (l) => lines.push(l) },
    );
    const pages = PagesFileSchema.parse(JSON.parse(readFileSync(join(out, "pages.json"), "utf8")));
    expect(pages.pages).toHaveLength(4);
    expect(pages.warnings.map((w) => w.kind)).toContain("scanned_or_figure_only");
    expect(existsSync(join(out, "source.pdf"))).toBe(true);
    const yaml = readFileSync(join(out, "guide.yaml"), "utf8");
    expect(yaml).toMatch(/^# Teaching guide DRAFT for "Waiting Out Loud/);
    expect(validateGuide(parseYaml(yaml), 4).ok).toBe(true);
    expect(lines.join("\n")).toContain("Page 3 has very little extractable text");
  });

  it("never overwrites existing files without --force", async () => {
    const out = tempDir();
    const quiet = { env, log: () => {} };
    await ingestCommand(pdf, { paper: "p", local: true, out, guide: false }, quiet);
    expect(existsSync(join(out, "guide.yaml"))).toBe(false);
    const lines: string[] = [];
    await ingestCommand(pdf, { paper: "p", local: true, out }, { env, log: (l) => lines.push(l) });
    expect(existsSync(join(out, "pages.extracted.json"))).toBe(true);
    expect(existsSync(join(out, "guide.yaml"))).toBe(true);
    expect(lines.at(-1)).toContain("--force");
    await ingestCommand(pdf, { paper: "p", local: true, out }, quiet);
    expect(existsSync(join(out, "guide.draft.yaml"))).toBe(true);
  });

  it("saves an invalid draft with its issues listed", async () => {
    const out = tempDir();
    const lines: string[] = [];
    await ingestCommand(
      pdf,
      { paper: "p", local: true, out },
      {
        env,
        log: (l) => lines.push(l),
        mockResponder: (c) => {
          if (c.purpose !== "guide_draft") return defaultMockResponder(c);
          const g = JSON.parse(defaultMockResponder(c) as string);
          g.starter_questions = ["Only one?"];
          return JSON.stringify(g);
        },
      },
    );
    const yaml = readFileSync(join(out, "guide.yaml"), "utf8");
    expect(yaml).toContain("# DRAFT DOES NOT VALIDATE");
    expect(yaml).toContain("#   - starter_questions:");
    expect(parseYaml(yaml).starter_questions).toEqual(["Only one?"]);
    expect(lines.join("\n")).toContain("does not validate");
  });

  it("rejects database mode (M5), bad slugs, missing files and unknown extractors", async () => {
    const quiet = { env, log: () => {} };
    await expect(ingestCommand(pdf, { paper: "p" }, quiet)).rejects.toThrow(/M5/);
    await expect(ingestCommand(pdf, { paper: "Bad Slug", local: true }, quiet)).rejects.toThrow(
      /slug/,
    );
    await expect(
      ingestCommand(join(tempDir(), "missing.pdf"), { paper: "p", local: true }, quiet),
    ).rejects.toThrow(/not found/);
    await expect(
      ingestCommand(pdf, { paper: "p", local: true, extractor: "ocr" }, quiet),
    ).rejects.toThrow(/unpdf or docling/);
  });
});
