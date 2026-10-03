import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}", "apps/*/{src,lib,app}/**/*.test.{ts,tsx}"],
    environment: "node",
    env: { LLM_PROVIDER: "mock" },
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: ["**/*.test.*", "**/__tests__/**"],
    },
  },
});
