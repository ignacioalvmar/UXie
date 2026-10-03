import { defineConfig } from "vitest/config";

/** `pnpm test:db`: RLS and repository tests against the local Supabase stack (PRD §15). */
export default defineConfig({
  test: {
    include: ["packages/db/test/**/*.test.ts"],
    globalSetup: ["packages/db/test/setup.ts"],
    environment: "node",
    // Tests share one database; run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
