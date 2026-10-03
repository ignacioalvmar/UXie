import type { LlmProvider, Price } from "@uxie/core";

/**
 * Suggestions for the instructor's model picker (FR-9.6). Not a whitelist: any model id the
 * provider accepts can be entered. Claude ids, context windows and prices come from Anthropic's
 * model reference (2026-09); OpenAI and Gemini ids come from the installed AI SDK provider type
 * definitions. Where context window or prices are null the instructor enters them on the settings
 * page (costs show as €0 until a price is set). Recheck prices before launch (PRD §17.4).
 */
export interface CatalogModel {
  provider: LlmProvider;
  model: string;
  label: string;
  /** Suggested use: the main tutor, or the cheap/fast state model (assessment, summaries). */
  suggestedFor: ("tutor" | "state")[];
  contextWindow: number | null;
  /** USD per million tokens. */
  price: Price | null;
}

const anthropicPrice = (input: number, cached: number, output: number): Price => ({
  in: input,
  cached,
  write5m: input * 1.25,
  write1h: input * 2,
  out: output,
});

export const MODEL_CATALOG: CatalogModel[] = [
  {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    suggestedFor: ["tutor"],
    contextWindow: 1_000_000,
    price: anthropicPrice(2, 0.2, 10),
  },
  {
    provider: "anthropic",
    model: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    suggestedFor: ["tutor"],
    contextWindow: 1_000_000,
    price: anthropicPrice(4, 0.2, 20),
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    suggestedFor: ["state"],
    contextWindow: 200_000,
    price: anthropicPrice(1, 0.1, 5),
  },

  {
    provider: "openai",
    model: "gpt-6-sol",
    label: "GPT-6 Sol",
    suggestedFor: ["tutor"],
    contextWindow: null,
    price: null,
  },
  {
    provider: "openai",
    model: "gpt-6-luna",
    label: "GPT-6 Luna",
    suggestedFor: ["tutor", "state"],
    contextWindow: null,
    price: null,
  },
  {
    provider: "openai",
    model: "gpt-5.5",
    label: "GPT-5.5",
    suggestedFor: ["tutor"],
    contextWindow: null,
    price: null,
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    suggestedFor: ["state"],
    contextWindow: null,
    price: null,
  },
  {
    provider: "openai",
    model: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    suggestedFor: ["state"],
    contextWindow: null,
    price: null,
  },

  {
    provider: "google",
    model: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (preview)",
    suggestedFor: ["tutor"],
    contextWindow: null,
    price: null,
  },
  {
    provider: "google",
    model: "gemini-pro-latest",
    label: "Gemini Pro (latest)",
    suggestedFor: ["tutor"],
    contextWindow: null,
    price: null,
  },
  {
    provider: "google",
    model: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    suggestedFor: ["tutor", "state"],
    contextWindow: null,
    price: null,
  },
  {
    provider: "google",
    model: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    suggestedFor: ["state"],
    contextWindow: null,
    price: null,
  },
];

export const catalogEntry = (provider: LlmProvider, model: string) =>
  MODEL_CATALOG.find((m) => m.provider === provider && m.model === model) ?? null;
