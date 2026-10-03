import { createAnthropic } from "@ai-sdk/anthropic";
import type { SystemModelMessage } from "ai";
import { acceptsEffort } from "../capabilities";
import type { LlmEnv } from "../types";
import type { ProviderAdapter } from "./types";

/**
 * Anthropic (default provider, ADR-012). Two system blocks: the stable prefix carries the cache
 * breakpoint (TTL from LLM_CACHE_TTL); the dynamic part follows uncached. Adaptive thinking stays
 * at the model default; `effort` is sent only for tutor replies and only to models that accept it.
 */
export function anthropicAdapter(env: LlmEnv, fetch?: typeof globalThis.fetch): ProviderAdapter {
  const provider = createAnthropic({ apiKey: env.LLM_API_KEY, fetch });
  const cacheControl =
    env.LLM_CACHE_TTL === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  return {
    name: "anthropic",
    structuredMode: "native",
    model: (id) => provider(id),
    instructions: (p) => {
      const blocks: SystemModelMessage[] = [
        {
          role: "system",
          content: p.stablePrefix,
          providerOptions: { anthropic: { cacheControl } },
        },
      ];
      if (p.dynamicSystem) blocks.push({ role: "system", content: p.dynamicSystem });
      return blocks;
    },
    providerOptions: (modelId, purpose) =>
      purpose === "tutor" && acceptsEffort("anthropic", modelId)
        ? { anthropic: { effort: env.LLM_EFFORT } }
        : undefined,
  };
}
