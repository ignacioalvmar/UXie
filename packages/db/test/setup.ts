import { execFileSync } from "node:child_process";

/**
 * Global setup for `pnpm test:db`: reads URL and keys of the running local stack
 * (`supabase start`) so the RLS suite never needs hosted credentials.
 */
export default function setup() {
  let out: string;
  try {
    out = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "The local Supabase stack is not running. Start it with `pnpm exec supabase start`.",
    );
  }
  const status = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string>;
  const url = status.API_URL;
  const publishable = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secret = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  if (!url || !publishable || !secret) throw new Error("Unexpected `supabase status` output");
  process.env.TEST_SUPABASE_URL = url;
  process.env.TEST_SUPABASE_PUBLISHABLE_KEY = publishable;
  process.env.TEST_SUPABASE_SECRET_KEY = secret;
  process.env.TEST_MAILPIT_URL =
    status.INBUCKET_URL ?? status.MAILPIT_URL ?? "http://127.0.0.1:54324";
}
