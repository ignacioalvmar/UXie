import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BaseEnvSchema,
  llmSettingsFromEnv,
  parseEnv,
  validateGuide,
  type GuideIssue,
  type Page,
} from "@uxie/core";
import type { ClaimedJob } from "@uxie/db";
import { loadGuidePrompts, unpdfExtractor, type Extractor } from "@uxie/ingest";
import { createGateway, defaultMockResponder, LlmError, type MockResponder } from "@uxie/llm";
import { processJob, type JobDeps, type WorkerStore } from "./jobs";

const prompts = loadGuidePrompts(fileURLToPath(new URL("../../../prompts/", import.meta.url)));
const pdf = new Uint8Array(
  readFileSync(new URL("../../../fixtures/papers/visible-cues/source.pdf", import.meta.url)),
);

function llm(responder: MockResponder = defaultMockResponder) {
  const env = parseEnv(BaseEnvSchema, { LLM_PROVIDER: "mock" });
  return createGateway(llmSettingsFromEnv(env), { mockResponder: responder });
}

class MemoryStore implements WorkerStore {
  status = "processing";
  steps: string[] = [];
  pages: Page[] = [];
  guide: { guide: Record<string, unknown> | null; issues: GuideIssue[] } | null = null;
  loads = 0;
  constructor(private readonly source: () => Uint8Array = () => pdf) {}
  async loadSource() {
    this.loads += 1;
    return { pdf: this.source(), title: "Visible Cues" };
  }
  async loadExtracted() {
    return { title: "Visible Cues", pages: this.pages, referencesStartPage: null };
  }
  async setStep(_v: string, step: string) {
    this.steps.push(step);
  }
  async saveExtraction(_v: string, e: { pages: Page[] }) {
    this.pages = e.pages;
  }
  async saveGuideDraft(
    _v: string,
    d: { guide: Record<string, unknown> | null; issues: GuideIssue[] },
  ) {
    this.guide = { guide: d.guide, issues: d.issues };
  }
  async markReady() {
    this.status = "ready";
  }
  async markFailed() {
    this.status = "failed";
  }
}

function setup(
  store: MemoryStore,
  opts: { responder?: MockResponder; extractor?: Extractor } = {},
) {
  const calls: string[] = [];
  const deps: JobDeps = {
    queue: {
      succeed: async (id) => void calls.push(`succeed:${id}`),
      fail: async (id, error) => void calls.push(`fail:${id}:${error}`),
      requeue: async (id) => void calls.push(`requeue:${id}`),
    },
    store: () => store,
    extractor: () => opts.extractor ?? unpdfExtractor(),
    defaultExtractor: "unpdf",
    guide: async () => ({ llm: llm(opts.responder), prompts }),
    tokenWarn: 60_000,
    maxAttempts: 2,
    log: { info() {}, warn() {}, error() {} },
  };
  return { deps, calls };
}

const job = (patch: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: "job-1",
  versionId: "v-1",
  kind: "ingest",
  attempts: 1,
  extractor: null,
  ...patch,
});

describe("worker jobs (FR-5.1 step 4, FR-5.5, FR-6.4)", () => {
  it("FR-5.1 an ingest job extracts, drafts a valid guide and marks the version ready", async () => {
    const store = new MemoryStore();
    const { deps, calls } = setup(store);
    expect(await processJob(job(), deps)).toBe("succeeded");
    expect(store.status).toBe("ready");
    expect(store.steps).toEqual(["extract", "analyze", "draft_guide"]);
    expect(store.pages.length).toBeGreaterThan(3);
    expect(validateGuide(store.guide!.guide, store.pages.length).ok).toBe(true);
    expect(calls).toEqual(["succeed:job-1"]);
  });

  it("FR-5.5 a PDF without text fails the version with a hint and fails the job", async () => {
    const store = new MemoryStore();
    const empty: Extractor = {
      name: "unpdf",
      extract: async () => ({ pages: [{ n: 1, text: "  " }], meta: { authors: [] } }),
    };
    const { deps, calls } = setup(store, { extractor: empty });
    expect(await processJob(job(), deps)).toBe("failed");
    expect(store.status).toBe("failed");
    expect(calls[0]).toMatch(/^fail:job-1:.*docling/);
  });

  it("infrastructure errors re-queue the job while attempts remain, then fail it", async () => {
    const store = new MemoryStore(() => {
      throw new Error("storage unreachable");
    });
    const first = setup(store);
    expect(await processJob(job({ attempts: 1 }), first.deps)).toBe("requeued");
    expect(first.calls).toEqual(["requeue:job-1"]);
    expect(store.status).toBe("processing");

    const second = setup(store);
    expect(await processJob(job({ attempts: 2 }), second.deps)).toBe("failed");
    expect(second.calls).toEqual(["fail:job-1:storage unreachable"]);
    expect(store.status).toBe("failed");
  });

  it("FR-6.4 Regenerate draft re-drafts from the stored pages", async () => {
    const store = new MemoryStore();
    await processJob(job(), setup(store).deps);
    store.guide = null;
    const { deps, calls } = setup(store);
    expect(await processJob(job({ id: "job-2", kind: "draft_guide" }), deps)).toBe("succeeded");
    expect(store.loads).toBe(1); // the PDF is not read again
    expect(validateGuide(store.guide!.guide, store.pages.length).ok).toBe(true);
    expect(calls).toEqual(["succeed:job-2"]);
  });

  it("FR-5.4 a provider failure while re-drafting is recorded as a guide issue, not a job failure", async () => {
    const store = new MemoryStore();
    await processJob(job(), setup(store).deps);
    const failing: MockResponder = (req) => {
      if (req.purpose === "guide_draft") throw new LlmError("auth_failed", "bad key");
      return defaultMockResponder(req);
    };
    const { deps, calls } = setup(store, { responder: failing });
    expect(await processJob(job({ id: "job-3", kind: "draft_guide" }), deps)).toBe("succeeded");
    expect(store.guide!.guide).toBeNull();
    expect(store.guide!.issues[0]!.message).toMatch(/Guide drafting failed/);
    expect(calls).toEqual(["succeed:job-3"]);
  });
});
