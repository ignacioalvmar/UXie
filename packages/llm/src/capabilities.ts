import type { Effort, LlmProvider } from "@uxie/core";

/**
 * Anthropic models that reject non-default sampling parameters (temperature/top_p/top_k → 400):
 * Sonnet 5.5, Sonnet 5, Opus 5.5, Opus 5, Opus 4.7/4.8, Fable, Mythos.
 */
const ANTHROPIC_NO_SAMPLING = /^claude-(sonnet-5|opus-5|opus-4-[78]|fable|mythos)/;

/** Anthropic models without the `effort` parameter (it errors on Haiku 4.5 and Sonnet 4.5). */
const ANTHROPIC_NO_EFFORT = /^claude-(haiku|sonnet-4-5|3)/;

/**
 * OpenAI reasoning models: the o-series and GPT-5+ except `*-chat-*` variants (same rule as
 * @ai-sdk/openai). They reject temperature and take `reasoningEffort` instead.
 */
export function isOpenAIReasoningModel(model: string): boolean {
  if (/^o\d+(-|$)/.test(model)) return true;
  const m = /^gpt-(\d+)(?:\.\d+)?(?:-(.+))?$/.exec(model);
  return m !== null && Number(m[1]) >= 5 && !(m[2] ?? "").startsWith("chat");
}

/** Gemini 3+ models take `thinkingLevel`; 2.x use a token budget, which we leave at the default. */
export const isGeminiThinkingLevelModel = (model: string) =>
  Number(/^gemini-(\d+)/.exec(model)?.[1] ?? 0) >= 3;

export function acceptsTemperature(provider: LlmProvider, model: string): boolean {
  if (provider === "anthropic") return !ANTHROPIC_NO_SAMPLING.test(model);
  if (provider === "openai") return !isOpenAIReasoningModel(model);
  return true;
}

export function acceptsEffort(provider: LlmProvider, model: string): boolean {
  if (provider === "anthropic") return !ANTHROPIC_NO_EFFORT.test(model);
  if (provider === "openai") return isOpenAIReasoningModel(model);
  if (provider === "google") return isGeminiThinkingLevelModel(model);
  return false;
}

/** OpenAI reasoning effort: `max` exists only on GPT-6 models; use `high` elsewhere. */
const gptMajor = (model: string) => Number(/^gpt-(\d+)/.exec(model)?.[1] ?? 0);
export const openaiReasoningEffort = (effort: Effort, model: string) =>
  effort === "max" && gptMajor(model) < 6 ? "high" : effort;

/** Gemini thinking level: low | medium | high. */
export const geminiThinkingLevel = (effort: Effort) => (effort === "max" ? "high" : effort);
