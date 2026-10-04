import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security";

// Local development: also read the repo-root .env (Next only reads apps/web/.env*). Values that
// are already set (Vercel env, apps/web/.env.local) win; loadEnvFile never overwrites.
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (process.env.NODE_ENV !== "production" && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // Workspace packages ship TypeScript source (ADR-013).
  transpilePackages: ["@uxie/core", "@uxie/character", "@uxie/db", "@uxie/llm", "@uxie/tutor"],
  poweredByHeader: false,
  // NFR-9. The nonce'd Content-Security-Policy is set per request in proxy.ts.
  headers: async () => [
    {
      source: "/:path*",
      headers: staticSecurityHeaders(process.env.NODE_ENV === "production"),
    },
  ],
  // Files read from disk at request time ship with their functions: the privacy notice, and the
  // tutor prompts for the chat routes (lib/engine.ts reads ../../prompts, PRD §8.5).
  outputFileTracingIncludes: {
    "/privacy": ["./content/**"],
    "/onboarding": ["./content/**"],
    "/api/conversations": ["../../prompts/**"],
    "/api/conversations/[id]/messages": ["../../prompts/**"],
    "/api/conversations/[id]/mode": ["../../prompts/**"],
    "/api/admin/versions/[id]/test-chat": ["../../prompts/**"],
  },
};

export default config;
