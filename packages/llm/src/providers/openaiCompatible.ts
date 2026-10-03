import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderCredential } from "@uxie/core";
import { LlmError } from "../types";
import { joinedInstructions, type ProviderAdapter } from "./types";

/**
 * Any OpenAI-compatible endpoint: Ollama / LM Studio for local development, GWDG Academic Cloud,
 * vLLM. One system message with the stable prefix first, so automatic prefix caching works where
 * the server supports it. Structured output uses JSON-only instructions because many of these
 * servers lack JSON-schema output.
 */
export function openaiCompatibleAdapter(
  cred: ProviderCredential | undefined,
  fetch?: typeof globalThis.fetch,
): ProviderAdapter {
  if (!cred?.baseUrl)
    throw new LlmError(
      "provider_error",
      "A base URL is required for the OpenAI-compatible provider",
    );
  const provider = createOpenAICompatible({
    name: "openai_compatible",
    baseURL: cred.baseUrl,
    apiKey: cred.apiKey,
    includeUsage: true,
    fetch,
  });
  return {
    name: "openai_compatible",
    structuredMode: "json_prompt",
    model: (id) => provider(id),
    instructions: joinedInstructions,
    providerOptions: () => undefined,
  };
}
