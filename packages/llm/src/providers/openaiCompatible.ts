import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { LlmError, type LlmEnv } from "../types";
import { joinedInstructions, type ProviderAdapter } from "./types";

/**
 * Any OpenAI-compatible endpoint: Ollama / LM Studio for local development, GWDG Academic Cloud,
 * vLLM. One system message with the stable prefix first, so automatic prefix caching works where
 * the server supports it. Structured output uses JSON-only instructions because many of these
 * servers lack JSON-schema output.
 */
export function openaiCompatibleAdapter(
  env: LlmEnv,
  fetch?: typeof globalThis.fetch,
): ProviderAdapter {
  if (!env.LLM_BASE_URL) throw new LlmError("provider_error", "LLM_BASE_URL is required");
  const provider = createOpenAICompatible({
    name: "openai_compatible",
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
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
