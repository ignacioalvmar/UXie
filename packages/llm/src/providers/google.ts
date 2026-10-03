import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LlmEnv } from "../types";
import { joinedInstructions, type ProviderAdapter } from "./types";

/**
 * Google Gemini, paid tier only (free-tier terms allow training on inputs, NFR-2).
 * One system instruction, prefix first; Gemini caches repeated prefixes implicitly.
 */
export function googleAdapter(env: LlmEnv, fetch?: typeof globalThis.fetch): ProviderAdapter {
  const provider = createGoogleGenerativeAI({ apiKey: env.LLM_API_KEY, fetch });
  return {
    name: "google",
    structuredMode: "native",
    model: (id) => provider(id),
    instructions: joinedInstructions,
    providerOptions: () => undefined,
  };
}
