import { createOpenAI } from "@ai-sdk/openai";
import { promptHash, type LlmSettings, type ProviderCredential } from "@uxie/core";
import { acceptsEffort, openaiReasoningEffort } from "../capabilities";
import { joinedInstructions, type ProviderAdapter } from "./types";

/**
 * OpenAI (Responses API). One system/developer message with the stable prefix first: OpenAI
 * caches identical prefixes ≥ 1024 tokens automatically, and `promptCacheKey` (a hash of the
 * stable prefix) routes turns of the same paper to the same cache. `store: false` keeps responses
 * from being stored on OpenAI's side (NFR-1). Reasoning models get `reasoningEffort` for tutor
 * replies; the gateway never sends them a temperature.
 */
export function openaiAdapter(
  cred: ProviderCredential | undefined,
  settings: LlmSettings,
  fetch?: typeof globalThis.fetch,
): ProviderAdapter {
  const provider = createOpenAI({ apiKey: cred?.apiKey, fetch });
  return {
    name: "openai",
    structuredMode: "native",
    model: (id) => provider(id),
    instructions: joinedInstructions,
    providerOptions: (modelId, purpose, p) => ({
      openai: {
        store: false,
        // Our zod schemas use optional fields and defaults; we validate (and repair) ourselves.
        strictJsonSchema: false,
        promptCacheKey: `uxie-${promptHash([p.stablePrefix])}`,
        ...(purpose === "tutor" && acceptsEffort("openai", modelId)
          ? { reasoningEffort: openaiReasoningEffort(settings.effort, modelId) }
          : {}),
      },
    }),
  };
}
