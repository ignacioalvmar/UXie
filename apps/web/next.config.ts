import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source (ADR-013).
  transpilePackages: ["@uxie/core", "@uxie/character", "@uxie/db", "@uxie/llm", "@uxie/tutor"],
  poweredByHeader: false,
  // The privacy notice is read from disk at request time; ship it with the functions.
  outputFileTracingIncludes: {
    "/privacy": ["./content/**"],
    "/onboarding": ["./content/**"],
  },
};

export default config;
