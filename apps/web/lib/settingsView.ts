import { LLM_ROLES, type LlmProvider, type LlmSettings, type Price } from "@uxie/core";
import type { EffectiveSettings } from "@uxie/db";
import { acceptsTemperature, MODEL_CATALOG } from "@uxie/llm";

/**
 * What /admin/settings/ai may send to the browser (FR-9.7): everything except key values.
 * Pure, so a test can assert that no key leaves the server.
 */
export const KEYED_PROVIDERS = ["anthropic", "openai", "google", "openai_compatible"] as const;

export interface SettingsView {
  roles: LlmSettings["roles"];
  effort: LlmSettings["effort"];
  cacheTtl: LlmSettings["cacheTtl"];
  temperature: number | null;
  maxOutputTokens: number;
  contextWindow: number;
  /** Prices of the models currently used by a role (USD per million tokens). */
  prices: Record<string, Price | null>;
  credentials: Record<
    (typeof KEYED_PROVIDERS)[number],
    {
      source: "stored" | "env" | null;
      keyHint: string | null;
      baseUrl: string | null;
      workspaceId: string | null;
      problem: string | null;
    }
  >;
  saved: boolean;
  updatedAt: string | null;
  catalog: {
    provider: LlmProvider;
    model: string;
    label: string;
    suggestedFor: string[];
    price: Price | null;
  }[];
  /** provider:model → whether temperature can be set (sampling-locked models reject it). */
  temperatureAllowed: Record<string, boolean>;
}

export function settingsView(eff: EffectiveSettings): SettingsView {
  const s = eff.settings;
  const used = [...new Set(LLM_ROLES.map((r) => s.roles[r].model))];
  const temperatureAllowed: Record<string, boolean> = {};
  for (const m of MODEL_CATALOG)
    temperatureAllowed[`${m.provider}:${m.model}`] = acceptsTemperature(m.provider, m.model);
  for (const r of LLM_ROLES) {
    const { provider, model } = s.roles[r];
    temperatureAllowed[`${provider}:${model}`] = acceptsTemperature(provider, model);
  }
  return {
    roles: s.roles,
    effort: s.effort,
    cacheTtl: s.cacheTtl,
    temperature: s.temperature ?? null,
    maxOutputTokens: s.maxOutputTokens,
    contextWindow: s.contextWindow,
    prices: Object.fromEntries(
      used.map((m) => [m, s.prices[m] ?? MODEL_CATALOG.find((c) => c.model === m)?.price ?? null]),
    ),
    credentials: eff.credentials,
    saved: eff.saved,
    updatedAt: eff.updatedAt,
    catalog: MODEL_CATALOG.map((m) => ({
      provider: m.provider,
      model: m.model,
      label: m.label,
      suggestedFor: m.suggestedFor,
      price: m.price,
    })),
    temperatureAllowed,
  };
}
