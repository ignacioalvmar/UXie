import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createServiceClient, type Db } from "@uxie/db";
import { serverEnv } from "../env";

/**
 * Session-scoped client: the user's cookies + the publishable key, so every query runs under RLS
 * (PRD §9.2). Use it for reads that the database itself should authorize.
 */
export async function userClient(): Promise<Db> {
  // cookies() first: it marks the route dynamic before env is read (no prerendering with secrets).
  const store = await cookies();
  const env = serverEnv();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // Called from a Server Component: the proxy refreshes the session cookies instead.
          }
        },
      },
    },
  ) as unknown as Db;
}

let service: Db | undefined;

/**
 * Secret-key client (bypasses RLS). Only after an explicit authorization check in code
 * (ADR-003, NFR-7). `server-only` keeps it out of client bundles (NFR-6).
 */
export function serviceDb(): Db {
  const env = serverEnv();
  service ??= createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  return service;
}
