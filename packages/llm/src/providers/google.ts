import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LlmSettings, ProviderCredential } from "@uxie/core";
import { acceptsEffort, geminiThinkingLevel } from "../capabilities";
import { joinedInstructions, type ProviderAdapter } from "./types";

/**
 * Google Gemini (paid tier only: free-tier terms allow training on inputs, NFR-2).
 * One system instruction, prefix first; Gemini 2.5+ caches repeated prefixes implicitly.
 * Gemini 3+ tutor replies get a thinking level derived from the effort setting.
 */
export function googleAdapter(
  cred: ProviderCredential | undefined,
  settings: LlmSettings,
  fetch?: typeof globalThis.fetch,
): ProviderAdapter {
  const provider = createGoogleGenerativeAI({ apiKey: cred?.apiKey, fetch });
  return {
    name: "google",
    structuredMode: "native",
    model: (id) => provider(id),
    instructions: joinedInstructions,
    providerOptions: (modelId, purpose) =>
      purpose === "tutor" && acceptsEffort("google", modelId)
        ? { google: { thinkingConfig: { thinkingLevel: geminiThinkingLevel(settings.effort) } } }
        : undefined,
  };
}
