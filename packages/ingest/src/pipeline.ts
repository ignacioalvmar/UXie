import { createHash } from "node:crypto";
import {
  PagesFileSchema,
  type ExtractionWarning,
  type GuideIssue,
  type Page,
  type PagesFile,
} from "@uxie/core";
import { LlmError, type LlmGateway } from "@uxie/llm";
import { analyzePages, type Analysis } from "./analyze";
import {
  ExtractionError,
  type Extractor,
  type ExtractorName,
  type PdfMeta,
} from "./extractors/types";
import { draftGuide, type GuideDraftResult, type GuidePrompts } from "./guideDraft";
import { normalizePages } from "./normalize";

/** Guide drafting reads the whole paper and writes several thousand tokens. */
export const GUIDE_DRAFT_TIMEOUT_MS = 300_000;

export type IngestStep = "extract" | "analyze" | "draft_guide";

export interface IngestOptions {
  extractor: Extractor;
  tokenWarn: number;
  /** Title to use instead of the PDF's metadata or first line. */
  title?: string;
  /** Omit to skip guide drafting. */
  guide?: { llm: LlmGateway; prompts: GuidePrompts; timeoutMs?: number };
  signal?: AbortSignal;
  onStep?: (step: IngestStep) => void | Promise<void>;
}

export interface IngestResult {
  sha256: string;
  extractor: ExtractorName;
  pagesFile: PagesFile;
  analysis: Analysis;
  /** Null when drafting was skipped. A provider failure is reported as an issue, not thrown. */
  guide: GuideDraftResult | null;
}

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** --title, else the PDF's own title, else the first line of page 1. */
export function resolveTitle(meta: PdfMeta, pages: readonly Page[], override?: string): string {
  const firstLine = pages[0]?.text.split("\n").find((l) => l.trim().length >= 3);
  return (override ?? meta.title ?? firstLine ?? "Untitled paper").trim().slice(0, 300);
}

function failedDraft(e: unknown, deps: NonNullable<IngestOptions["guide"]>): GuideDraftResult {
  const { provider, model } = deps.llm.modelFor("guide_draft");
  const message =
    e instanceof LlmError
      ? `Guide drafting failed (${e.code}): ${e.message}`
      : `Guide drafting failed: ${String(e)}`;
  return {
    ok: false,
    guide: null,
    draft: null,
    issues: [{ path: "(draft)", message }],
    attempts: 1,
    repairedIssues: [],
    promptVersion: deps.prompts.version,
    model,
    provider,
    usage: [],
  };
}

/**
 * Extract → normalize → analyze → draft guide (FR-5.2–5.4). Throws `ExtractionError` when the
 * PDF yields no text; everything after extraction degrades to warnings and guide issues, because
 * a version is `ready` once extraction succeeded.
 */
export async function ingestPdf(pdf: Uint8Array, opts: IngestOptions): Promise<IngestResult> {
  const sha256 = sha256Hex(pdf);
  await opts.onStep?.("extract");
  const extraction = await opts.extractor.extract(pdf, { signal: opts.signal });
  const pages = normalizePages(extraction.pages);
  if (!pages.some((p) => p.text.trim())) {
    throw new ExtractionError(
      opts.extractor.name,
      opts.extractor.name === "unpdf"
        ? "The PDF has no extractable text (scanned?). Retry with EXTRACTOR=docling, which runs OCR."
        : "The PDF has no extractable text.",
    );
  }

  await opts.onStep?.("analyze");
  const analysis = analyzePages(pages, { tokenWarn: opts.tokenWarn });
  const title = resolveTitle(extraction.meta, pages, opts.title);
  const pagesFile = PagesFileSchema.parse({
    title,
    authors: extraction.meta.authors,
    ...(extraction.meta.year ? { year: extraction.meta.year } : {}),
    extractor: opts.extractor.name,
    warnings: analysis.warnings,
    pages,
  });

  let guide: GuideDraftResult | null = null;
  if (opts.guide) {
    await opts.onStep?.("draft_guide");
    try {
      guide = await draftGuide(
        { title, pages, referencesStartPage: analysis.referencesStartPage },
        {
          llm: opts.guide.llm,
          prompts: opts.guide.prompts,
          timeoutMs: opts.guide.timeoutMs ?? GUIDE_DRAFT_TIMEOUT_MS,
          signal: opts.signal,
        },
      );
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      guide = failedDraft(e, opts.guide);
    }
  }
  return { sha256, extractor: opts.extractor.name, pagesFile, analysis, guide };
}

/**
 * Storage for one ingest job (FR-5.1). Implemented over Supabase by `packages/db` (M5) and in
 * memory by tests; the worker claims a job and calls `runIngestJob`.
 */
export interface IngestStore {
  loadSource(versionId: string): Promise<{ pdf: Uint8Array; title?: string }>;
  setStep(versionId: string, step: IngestStep): Promise<void>;
  saveExtraction(
    versionId: string,
    e: {
      sha256: string;
      extractor: ExtractorName;
      pageCount: number;
      tokenEstimate: number;
      pages: Page[];
      warnings: ExtractionWarning[];
    },
  ): Promise<void>;
  /** `guide` is the raw draft; it is saved with status `draft` even when `issues` is non-empty. */
  saveGuideDraft(
    versionId: string,
    d: {
      guide: Record<string, unknown> | null;
      issues: GuideIssue[];
      promptVersion: string;
      model: string;
    },
  ): Promise<void>;
  markReady(versionId: string): Promise<void>;
  markFailed(versionId: string, error: string): Promise<void>;
}

export interface IngestJobDeps {
  store: IngestStore;
  extractor: Extractor;
  tokenWarn: number;
  guide?: IngestOptions["guide"];
  signal?: AbortSignal;
}

export type IngestJobOutcome =
  { status: "ready"; result: IngestResult } | { status: "failed"; error: string };

/**
 * FR-5.1 step 4: run one claimed job end to end and record the outcome on the version. An
 * unreadable PDF marks the version `failed` (FR-5.5); infrastructure errors are rethrown so the
 * worker can re-queue the job.
 */
export async function runIngestJob(
  versionId: string,
  deps: IngestJobDeps,
): Promise<IngestJobOutcome> {
  const { store } = deps;
  let result: IngestResult;
  try {
    const source = await store.loadSource(versionId);
    result = await ingestPdf(source.pdf, {
      extractor: deps.extractor,
      tokenWarn: deps.tokenWarn,
      title: source.title,
      guide: deps.guide,
      signal: deps.signal,
      onStep: (step) => store.setStep(versionId, step),
    });
  } catch (e) {
    if (!(e instanceof ExtractionError)) throw e;
    await store.markFailed(versionId, e.message);
    return { status: "failed", error: e.message };
  }
  await store.saveExtraction(versionId, {
    sha256: result.sha256,
    extractor: result.extractor,
    pageCount: result.analysis.pageCount,
    tokenEstimate: result.analysis.tokenEstimate,
    pages: result.pagesFile.pages,
    warnings: result.analysis.warnings,
  });
  if (result.guide) {
    await store.saveGuideDraft(versionId, {
      guide: result.guide.draft,
      issues: result.guide.issues,
      promptVersion: result.guide.promptVersion,
      model: result.guide.model,
    });
  }
  await store.markReady(versionId);
  return { status: "ready", result };
}
