import "server-only";
import { pingDb, ReviewRepo } from "@uxie/db";
import { pingRoles, type RolePing } from "@uxie/llm";
import { effectiveSettings } from "../llmSettings";
import { serviceDb } from "../supabase/server";

/** A worker that has not polled for this long is shown red (FR-9.5). */
export const HEARTBEAT_STALE_MS = 2 * 60_000;
const PING_TTL_MS = 60_000;

let pingCache: { at: number; results: RolePing[] } | undefined;

/** One tiny request per configured provider/model, cached 60 s per server instance. */
async function cachedPing(now: number): Promise<{ results: RolePing[]; cachedAt: string }> {
  if (!pingCache || now - pingCache.at > PING_TTL_MS) {
    const { settings } = await effectiveSettings();
    pingCache = { at: now, results: await pingRoles(settings).catch(() => []) };
  }
  return { results: pingCache.results, cachedAt: new Date(pingCache.at).toISOString() };
}

export interface AdminHealth {
  checkedAt: string;
  db: boolean;
  storage: boolean;
  llm: {
    ok: boolean;
    cachedAt: string;
    roles: Pick<RolePing, "role" | "provider" | "model" | "ok" | "latencyMs" | "errorCode">[];
  };
  workers: { name: string; lastSeenAt: string; stale: boolean }[];
  lastErrors: Awaited<ReturnType<ReviewRepo["lastErrors"]>>;
}

export async function adminHealth(now = Date.now()): Promise<AdminHealth> {
  const db = serviceDb();
  const repo = new ReviewRepo(db);
  const [dbOk, storage, llm, workers, lastErrors] = await Promise.all([
    pingDb(db).catch(() => false),
    repo.storageReachable().catch(() => false),
    cachedPing(now),
    repo.workerHeartbeats().catch(() => []),
    repo.lastErrors().catch(() => ({ llm: null, ingest: null })),
  ]);
  return {
    checkedAt: new Date(now).toISOString(),
    db: dbOk,
    storage,
    llm: {
      ok: llm.results.length > 0 && llm.results.every((r) => r.ok),
      cachedAt: llm.cachedAt,
      roles: llm.results.map(({ role, provider, model, ok, latencyMs, errorCode }) => ({
        role,
        provider,
        model,
        ok,
        latencyMs,
        errorCode,
      })),
    },
    workers: workers.map((w) => ({
      ...w,
      stale: now - new Date(w.lastSeenAt).getTime() > HEARTBEAT_STALE_MS,
    })),
    lastErrors,
  };
}
