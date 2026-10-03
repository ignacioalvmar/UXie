import { z } from "zod";

/**
 * Inference settings (PRD §7, §8.3, FR-9.6). One provider + model per role, credentials per
 * provider. Built from env (bootstrap / development) or from the instructor's settings page
 * (stored encrypted, FR-9.7). The gateway is created from this object, never from env directly.
 */

export const LlmProvider = z.enum(["anthropic", "openai", "google", "openai_compatible", "mock"]);
export type LlmProvider = z.infer<typeof LlmProvider>;

export const LLM_ROLES = ["tutor", "state", "judge"] as const;
export type LlmRole = (typeof LLM_ROLES)[number];

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  google: "Google (Gemini)",
  openai_compatible: "OpenAI-compatible endpoint",
  mock: "Mock (tests only)",
};

export const PriceSchema = z.object({
  /** USD per million tokens. */
  in: z.number().nonnegative(),
  cached: z.number().nonnegative(),
  write5m: z.number().nonnegative(),
  write1h: z.number().nonnegative(),
  out: z.number().nonnegative(),
});
export type Price = z.infer<typeof PriceSchema>;

export const RoleModelSchema = z.object({
  provider: LlmProvider,
  model: z.string().trim().min(1).max(120),
});
export type RoleModel = z.infer<typeof RoleModelSchema>;

export const ProviderCredentialSchema = z.object({
  apiKey: z.string().trim().min(1).max(500).optional(),
  baseUrl: z.url().optional(),
});
export type ProviderCredential = z.infer<typeof ProviderCredentialSchema>;

export const Effort = z.enum(["low", "medium", "high", "max"]);
export type Effort = z.infer<typeof Effort>;

export const LlmSettingsSchema = z.object({
  roles: z.object({ tutor: RoleModelSchema, state: RoleModelSchema, judge: RoleModelSchema }),
  /** Secrets. Server-only: never logged, never sent to a browser (use redactLlmSettings). */
  credentials: z.partialRecord(LlmProvider, ProviderCredentialSchema),
  effort: Effort,
  cacheTtl: z.enum(["5m", "1h"]),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive(),
  /** Context window of the tutor model, in tokens (drives the full/retrieval choice). */
  contextWindow: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  prices: z.record(z.string(), PriceSchema),
  usdToEur: z.number().positive(),
});
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

export const usedProviders = (s: Pick<LlmSettings, "roles">): LlmProvider[] => [
  ...new Set(LLM_ROLES.map((r) => s.roles[r].provider)),
];

/** Problems that make the settings unusable (missing keys, missing base URL). Names, no values. */
export function llmSettingsProblems(s: LlmSettings): string[] {
  const problems: string[] = [];
  for (const provider of usedProviders(s)) {
    const cred = s.credentials[provider];
    const roles = LLM_ROLES.filter((r) => s.roles[r].provider === provider).join(", ");
    if (
      (provider === "anthropic" || provider === "openai" || provider === "google") &&
      !cred?.apiKey
    ) {
      problems.push(`${PROVIDER_LABEL[provider]}: an API key is required (used for ${roles})`);
    }
    if (provider === "openai_compatible" && !cred?.baseUrl) {
      problems.push(`${PROVIDER_LABEL[provider]}: a base URL is required (used for ${roles})`);
    }
  }
  return problems;
}

/** What an admin page or a log may show: everything except secrets. */
export interface RedactedLlmSettings extends Omit<LlmSettings, "credentials"> {
  credentials: Partial<
    Record<LlmProvider, { hasApiKey: boolean; keyHint: string | null; baseUrl: string | null }>
  >;
}

/** Last four characters only, e.g. "…9xQz", so the instructor can tell keys apart. */
export const keyHint = (key: string) => (key.length > 8 ? `…${key.slice(-4)}` : "…");

export function redactLlmSettings(s: LlmSettings): RedactedLlmSettings {
  const credentials: RedactedLlmSettings["credentials"] = {};
  for (const [provider, cred] of Object.entries(s.credentials) as [
    LlmProvider,
    ProviderCredential,
  ][]) {
    credentials[provider] = {
      hasApiKey: Boolean(cred.apiKey),
      keyHint: cred.apiKey ? keyHint(cred.apiKey) : null,
      baseUrl: cred.baseUrl ?? null,
    };
  }
  return { ...s, credentials };
}

/**
 * An edit from the instructor's settings page (FR-9.6). For each credential field:
 * omitted → keep the stored value; `null` → remove it; a string → replace it.
 * Keys are write-only: the page never receives the stored value back.
 */
export const LlmSettingsUpdateSchema = LlmSettingsSchema.omit({ credentials: true })
  .partial()
  .extend({
    credentials: z
      .partialRecord(
        LlmProvider,
        z.object({
          apiKey: z.string().trim().min(1).max(500).nullable().optional(),
          baseUrl: z.url().nullable().optional(),
        }),
      )
      .optional(),
  });
export type LlmSettingsUpdate = z.infer<typeof LlmSettingsUpdateSchema>;

export function applyLlmSettingsUpdate(
  current: LlmSettings,
  update: LlmSettingsUpdate,
): LlmSettings {
  const { credentials: credUpdate, ...rest } = update;
  const credentials = structuredClone(current.credentials);
  for (const [provider, patch] of Object.entries(credUpdate ?? {}) as [
    LlmProvider,
    NonNullable<NonNullable<LlmSettingsUpdate["credentials"]>[LlmProvider]>,
  ][]) {
    const next: ProviderCredential = { ...credentials[provider] };
    if (patch.apiKey === null) delete next.apiKey;
    else if (patch.apiKey !== undefined) next.apiKey = patch.apiKey;
    if (patch.baseUrl === null) delete next.baseUrl;
    else if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl;
    if (Object.keys(next).length) credentials[provider] = next;
    else delete credentials[provider];
  }
  return LlmSettingsSchema.parse({ ...current, ...rest, credentials });
}

/** Secret-free summary for boot logs (FR-9.1). */
export function describeLlmSettings(s: LlmSettings) {
  return {
    tutor: `${s.roles.tutor.provider}:${s.roles.tutor.model}`,
    state: `${s.roles.state.provider}:${s.roles.state.model}`,
    judge: `${s.roles.judge.provider}:${s.roles.judge.model}`,
    contextWindow: s.contextWindow,
    effort: s.effort,
    cacheTtl: s.cacheTtl,
  };
}
