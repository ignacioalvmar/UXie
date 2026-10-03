import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pino } from "pino";
import { BaseEnvSchema, describeEnv, parseEnv } from "@uxie/core";

// Local development reads the repo-root .env; on Render the env group provides variables.
const localEnv = new URL("../../../.env", import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const env = parseEnv(BaseEnvSchema, process.env);
const log = pino({ level: env.LOG_LEVEL, base: { service: "uxie-worker" } });

let stopping = false;
const stop = (signal: string) => {
  log.info({ signal }, "shutdown requested; finishing current iteration");
  stopping = true;
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

log.info({ ...describeEnv(env), pollMs: env.WORKER_POLL_MS }, "worker started");

// M0 walking skeleton: heartbeat only. M3/M5 add claim_ingest_job() → runIngestJob() and the
// worker_heartbeats upsert (FR-5.1, FR-9.5); M9 adds scheduled maintenance (scheduled.ts).
let beats = 0;
while (!stopping) {
  beats += 1;
  log.info({ beats }, "heartbeat");
  await sleep(env.WORKER_POLL_MS);
}
log.info("worker stopped");
