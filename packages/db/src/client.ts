import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase clients (PRD §6 `db/src/client.ts`). The service client uses the secret key and
 * bypasses RLS, so callers must authorize first (ADR-003). It never runs in a browser bundle:
 * apps/web imports it only from `server-only` modules (NFR-6).
 */
export type Db = SupabaseClient;

export function createServiceClient(url: string, secretKey: string): Db {
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export class DbError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DbError";
  }
}

export class NotFoundError extends DbError {
  constructor(what: string) {
    super(`${what} not found`, "not_found");
    this.name = "NotFoundError";
  }
}

/** Unwrap a supabase-js result; error messages name the operation, never row content. */
export function must<T>(
  res: { data: T | null; error: { message: string; code?: string } | null },
  what: string,
): T {
  if (res.error) throw new DbError(`${what}: ${res.error.message}`, res.error.code);
  if (res.data === null) throw new NotFoundError(what);
  return res.data;
}

/** `select 1` equivalent for health checks (FR-9.5). */
export async function pingDb(db: Db): Promise<boolean> {
  const { error } = await db.from("modules").select("id", { head: true, count: "exact" }).limit(1);
  return !error;
}
