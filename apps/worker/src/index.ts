import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { pino } from "pino";
import { describeEnv, llmSettingsFromEnv, parseEnv, ServerEnvSchema } from "@uxie/core";
import {
  createServiceClient,
  IngestQueue,
  loadEffectiveSettings,
  SupabaseIngestStore,
  SupabaseLlmCallRepo,
} from "@uxie/db";
import { createExtractor, loadGuidePrompts, type GuidePrompts } from "@uxie/ingest";
import { createGateway } from "@uxie/llm";
import { processJob, type WorkerStore } from "./jobs";

// Local development reads the repo-root .env; on Render the env group provides variables.
const localEnv = new URL("../../../.env", import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const env = parseEnv(ServerEnvSchema, process.env);
const log = pino({ level: env.LOG_LEVEL, base: { service: "uxie-worker" } });
const db = createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const queue = new IngestQueue(db);
const llmCalls = new SupabaseLlmCallRepo(db);
const promptsDir = fileURLToPath(new URL("../../../prompts/", import.meta.url));
const MAX_ATTEMPTS = 2;
const HEARTBEAT_NAME = "ingest-worker";

let prompts: GuidePrompts | undefined;
const controller = new AbortController();
let stopping = false;
// NFR-17: finish the current job within WORKER_SHUTDOWN_GRACE_MS, then abort it; processJob
// re-queues an aborted job at once. A second signal aborts immediately.
const stop = (signal: string) => {
  if (stopping) return controller.abort();
  log.info(
    { signal, graceMs: env.WORKER_SHUTDOWN_GRACE_MS },
    "shutdown requested; finishing current job",
  );
  stopping = true;
  setTimeout(() => controller.abort(), env.WORKER_SHUTDOWN_GRACE_MS).unref();
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

/** The instructor's effective inference settings (FR-9.6), read per job like the web app does. */
async function guideDeps() {
  const { settings } = await loadEffectiveSettings(
    db,
    llmSettingsFromEnv(env),
    env.SETTINGS_ENCRYPTION_KEY,
  );
  const llm = createGateway(settings, {
    onUsage: (e) =>
      void llmCalls
        .record({
          conversationId: null,
          purpose: e.purpose,
          provider: e.usage.provider,
          model: e.usage.model,
          inputTokens: e.usage.inputTokens,
          outputTokens: e.usage.outputTokens,
          cachedInputTokens: e.usage.cachedInputTokens,
          cacheWriteInputTokens: e.usage.cacheWriteInputTokens,
          costEur: e.usage.costEur,
          latencyMs: e.usage.latencyMs,
          ttftMs: e.usage.ttftMs ?? null,
          ok: e.ok,
          errorCode: e.errorCode ?? null,
          meta: e.meta,
        })
        .catch((err: unknown) => log.warn({ err: String(err) }, "llm_call_not_recorded")),
  });
  prompts ??= loadGuidePrompts(promptsDir);
  return { llm, prompts };
}

log.info({ ...describeEnv(env), pollMs: env.WORKER_POLL_MS }, "worker started");

// FR-5.1 step 4 / FR-9.5: heartbeat, re-queue stale jobs, claim and run one job per iteration.
while (!stopping) {
  let claimed = false;
  try {
    await queue.heartbeat(HEARTBEAT_NAME, { host: hostname(), pid: process.pid });
    const requeued = await queue.requeueStale(env.WORKER_JOB_TIMEOUT_MS, MAX_ATTEMPTS);
    if (requeued) log.warn({ requeued }, "stale_jobs_requeued");
    const job = await queue.claim();
    if (job) {
      claimed = true;
      log.info({ jobId: job.id, kind: job.kind, attempt: job.attempts }, "job_claimed");
      await processJob(job, {
        queue,
        store: (jobId): WorkerStore => new SupabaseIngestStore(db, jobId),
        extractor: (name) => createExtractor(name, { doclingUrl: env.DOCLING_URL }),
        defaultExtractor: env.EXTRACTOR,
        guide: guideDeps,
        tokenWarn: env.PAPER_TOKEN_WARN,
        maxAttempts: MAX_ATTEMPTS,
        log,
        signal: controller.signal,
      });
    }
  } catch (e) {
    log.error({ err: e instanceof Error ? e.message : String(e) }, "poll_failed");
  }
  // Drain the queue without waiting; idle polls sleep.
  if (!claimed && !stopping) await sleep(env.WORKER_POLL_MS);
}
log.info("worker stopped");
