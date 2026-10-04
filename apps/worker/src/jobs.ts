import type { GuideIssue, Page } from "@uxie/core";
import type { ClaimedJob } from "@uxie/db";
import {
  draftGuide,
  GUIDE_DRAFT_TIMEOUT_MS,
  runIngestJob,
  type Extractor,
  type ExtractorName,
  type GuideDraftResult,
  type GuidePrompts,
  type IngestStore,
} from "@uxie/ingest";
import type { LlmGateway } from "@uxie/llm";

/**
 * One claimed job (FR-5.1 step 4, FR-6.4 "Regenerate draft"). The poll loop in index.ts wires
 * Supabase; tests wire memory. Outcomes: `succeeded`, `failed` (version marked failed for an
 * unreadable PDF, FR-5.5) or `requeued` (infrastructure error with attempts left).
 */

/** IngestStore plus what "Regenerate draft" reads (SupabaseIngestStore implements both). */
export interface WorkerStore extends IngestStore {
  loadExtracted(versionId: string): Promise<{
    title: string;
    pages: Page[];
    referencesStartPage: number | null;
  }>;
}

export interface JobQueue {
  succeed(jobId: string): Promise<void>;
  fail(jobId: string, error: string): Promise<void>;
  /** `attempts` overrides the counter (a shutdown gives the claimed attempt back). */
  requeue(jobId: string, error: string, attempts?: number): Promise<void>;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface JobDeps {
  queue: JobQueue;
  store: (jobId: string) => WorkerStore;
  extractor: (name: ExtractorName) => Extractor;
  defaultExtractor: ExtractorName;
  /** The gateway from the instructor's effective settings, built per job. */
  guide: () => Promise<{ llm: LlmGateway; prompts: GuidePrompts }>;
  tokenWarn: number;
  maxAttempts: number;
  log: Logger;
  signal?: AbortSignal;
}

export type JobOutcome = "succeeded" | "failed" | "requeued";

export const SHUTDOWN_NOTE = "The worker restarted during this job; it was re-queued.";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function processJob(job: ClaimedJob, deps: JobDeps): Promise<JobOutcome> {
  const store = deps.store(job.id);
  const started = Date.now();
  try {
    if (job.kind === "draft_guide") {
      await regenerateGuide(job.versionId, store, deps);
      await deps.queue.succeed(job.id);
    } else {
      const outcome = await runIngestJob(job.versionId, {
        store,
        extractor: deps.extractor(job.extractor ?? deps.defaultExtractor),
        tokenWarn: deps.tokenWarn,
        guide: await deps.guide(),
        signal: deps.signal,
      });
      if (outcome.status === "failed") {
        await deps.queue.fail(job.id, outcome.error);
        deps.log.warn({ jobId: job.id, versionId: job.versionId }, "ingest_failed");
        return "failed";
      }
      await deps.queue.succeed(job.id);
    }
    deps.log.info(
      { jobId: job.id, kind: job.kind, versionId: job.versionId, ms: Date.now() - started },
      "job_succeeded",
    );
    return "succeeded";
  } catch (e) {
    // NFR-17: the worker is shutting down and aborted the job. Not the job's fault: back to the
    // queue at once, without using up an attempt.
    if (deps.signal?.aborted) {
      deps.log.warn({ jobId: job.id, kind: job.kind }, "job_requeued_on_shutdown");
      await deps.queue.requeue(job.id, SHUTDOWN_NOTE, Math.max(0, job.attempts - 1));
      return "requeued";
    }
    // Infrastructure (download, database, network): retry on the next poll, up to maxAttempts.
    const error = message(e);
    deps.log.error({ jobId: job.id, kind: job.kind, attempts: job.attempts, error }, "job_error");
    if (job.attempts < deps.maxAttempts) {
      await deps.queue.requeue(job.id, error);
      return "requeued";
    }
    await deps.queue.fail(job.id, error);
    if (job.kind === "ingest") await store.markFailed(job.versionId, error).catch(() => {});
    return "failed";
  }
}

/** FR-6.4: re-draft from the stored pages; a provider failure is recorded as a guide issue. */
async function regenerateGuide(versionId: string, store: WorkerStore, deps: JobDeps) {
  const input = await store.loadExtracted(versionId);
  if (!input.pages.length) throw new Error("The version has no extracted pages.");
  await store.setStep(versionId, "draft_guide");
  const { llm, prompts } = await deps.guide();
  let result: GuideDraftResult | null = null;
  let issues: GuideIssue[];
  try {
    result = await draftGuide(input, {
      llm,
      prompts,
      timeoutMs: GUIDE_DRAFT_TIMEOUT_MS,
      signal: deps.signal,
    });
    issues = result.issues;
  } catch (e) {
    if (deps.signal?.aborted) throw e; // shutdown: re-queue instead of saving a failed draft
    issues = [{ path: "(draft)", message: `Guide drafting failed: ${message(e)}` }];
  }
  await store.saveGuideDraft(versionId, {
    guide: result?.draft ?? null,
    issues,
    promptVersion: result?.promptVersion ?? prompts.version,
    model: result?.model ?? llm.modelFor("guide_draft").model,
  });
}
