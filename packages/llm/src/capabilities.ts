import type { LlmProvider } from "@uxie/core";

/**
 * Anthropic models that reject non-default sampling parameters (temperature/top_p/top_k → 400):
 * Sonnet 5.5, Sonnet 5, Opus 5.5, Opus 5, Opus 4.7/4.8, Fable, Mythos.
 */
const ANTHROPIC_NO_SAMPLING = /^claude-(sonnet-5|opus-5|opus-4-[78]|fable|mythos)/;

/** Anthropic models without the `effort` parameter (it errors on Haiku 4.5 and Sonnet 4.5). */
const ANTHROPIC_NO_EFFORT = /^claude-(haiku|sonnet-4-5|3)/;

export function acceptsTemperature(provider: LlmProvider, model: string): boolean {
  return provider !== "anthropic" || !ANTHROPIC_NO_SAMPLING.test(model);
}

export function acceptsEffort(provider: LlmProvider, model: string): boolean {
  return provider === "anthropic" && !ANTHROPIC_NO_EFFORT.test(model);
}
