import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite (PRD §15, M10): the production build of apps/web plus the ingestion worker,
 * against the local Supabase stack, with LLM_PROVIDER=mock. Run with `pnpm test:e2e` from the repo
 * root (builds first). Supabase values come from the environment (CI: `supabase status -o env`) or
 * from apps/web/.env.local.
 */
const local = resolve(import.meta.dirname, ".env.local");
if (existsSync(local)) process.loadEnvFile(local);
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  // CI: read URL and keys of the running local stack, as `pnpm test:db` does.
  const out = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    cwd: resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const status = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string | undefined>;
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  process.env.SUPABASE_SECRET_KEY = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  process.env.MAILPIT_URL ??= status.INBUCKET_URL ?? status.MAILPIT_URL;
}

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

const serverEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? "",
  SETTINGS_ENCRYPTION_KEY:
    process.env.SETTINGS_ENCRYPTION_KEY ?? Buffer.alloc(32, 1).toString("base64"),
  APP_URL: BASE_URL,
  // The production build, but NODE_ENV=test: the env guard refuses the mock model in production.
  NODE_ENV: "test",
  LLM_PROVIDER: "mock",
  LLM_STATE_PROVIDER: "mock",
  LLM_API_KEY: "",
  ALLOWED_EMAIL_DOMAINS: "thi.de,studmail.thi.de",
  REGISTRATION_INVITE_CODE: "",
  // High enough that the suite never trips the per-minute limit.
  PER_MINUTE_TURN_LIMIT: "60",
  WORKER_POLL_MS: "1000",
  LOG_LEVEL: "warn",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "../../tmp/e2e-results",
  // Flows share the seeded paper and the worker; keep them in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "../../tmp/e2e-report", open: "never" }]]
    : [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: `pnpm exec next start -p ${PORT}`,
      url: `${BASE_URL}/api/health`,
      env: serverEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Ingestion worker for the instructor publish flow (no port; ready when it logs its start).
      command: "pnpm --filter @uxie/worker start",
      cwd: resolve(import.meta.dirname, "../.."),
      env: { ...serverEnv, LOG_LEVEL: "info" },
      wait: { stdout: /worker started/ },
      timeout: 120_000,
    },
  ],
});
