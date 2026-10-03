import type { generateText, Instructions, LanguageModel } from "ai";
import type { LlmProvider } from "@uxie/core";
import type { PromptParts, Purpose } from "../types";

export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

/**
 * Everything provider-specific about a call. The gateway owns the call itself (timeouts, retries,
 * streaming, usage, errors) so behaviour stays identical across providers.
 */
export interface ProviderAdapter {
  readonly name: LlmProvider;
  model(modelId: string, purpose: Purpose): LanguageModel;
  /** System content: the stable prefix first, so prefix caching works wherever supported. */
  instructions(p: PromptParts): Instructions;
  providerOptions(modelId: string, purpose: Purpose, p: PromptParts): ProviderOptions | undefined;
  /** `native`: provider JSON-schema output. `json_prompt`: JSON-only instructions + zod parse. */
  readonly structuredMode: "native" | "json_prompt";
}

/** One system string, prefix first (openai-compatible, google, mock). */
export function joinedInstructions(p: PromptParts): string {
  return p.dynamicSystem ? `${p.stablePrefix}\n\n${p.dynamicSystem}` : p.stablePrefix;
}
