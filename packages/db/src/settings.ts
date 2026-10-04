import type { LlmProvider } from "@uxie/core";
import {
  applyLlmSettingsUpdate,
  keyHint,
  LlmSettingsSchema,
  type LlmSettings,
  type LlmSettingsUpdate,
  type ProviderCredential,
} from "@uxie/core";
import { must, type Db } from "./client";
import { decryptSecret, encryptSecret, SecretsError } from "./secrets";

/**
 * Instructor-managed inference settings (FR-9.6, FR-9.7, ADR-020).
 *
 * Effective settings = the saved `llm_settings.config` (or env when nothing is saved yet), with
 * credentials taken from `llm_credentials` (decrypted here, on the server) and falling back to
 * env keys for providers without a stored key.
 */

const KEYED = ["anthropic", "openai", "google", "openai_compatible"] as const;
type KeyedProvider = (typeof KEYED)[number];

const aad = (provider: string) => `llm_credentials:${provider}`;

interface CredentialRow {
  provider: KeyedProvider;
  api_key_sealed: string | null;
  key_hint: string | null;
  base_url: string | null;
  workspace_id: string | null;
}

export interface CredentialStatus {
  /** Where the effective key comes from. */
  source: "stored" | "env" | null;
  keyHint: string | null;
  baseUrl: string | null;
  workspaceId: string | null;
  /** E.g. the stored key no longer decrypts after SETTINGS_ENCRYPTION_KEY rotation. */
  problem: string | null;
}

export interface EffectiveSettings {
  settings: LlmSettings;
  /** Whether the settings come from the database (true) or env only (false). */
  saved: boolean;
  credentials: Record<KeyedProvider, CredentialStatus>;
  updatedAt: string | null;
}

export async function loadEffectiveSettings(
  db: Db,
  envSettings: LlmSettings,
  encryptionKey: string | undefined,
): Promise<EffectiveSettings> {
  const configRes = await db.from("llm_settings").select("config, updated_at").maybeSingle();
  if (configRes.error) throw new Error(`llm_settings: ${configRes.error.message}`);
  const credRows = must(
    await db
      .from("llm_credentials")
      .select("provider, api_key_sealed, key_hint, base_url, workspace_id"),
    "llm_credentials",
  ) as CredentialRow[];

  const credentials: Partial<Record<LlmProvider, ProviderCredential>> = structuredClone(
    envSettings.credentials,
  );
  const status = Object.fromEntries(
    KEYED.map((p) => {
      const env = envSettings.credentials[p];
      return [
        p,
        {
          source: env?.apiKey ? "env" : null,
          keyHint: env?.apiKey ? keyHint(env.apiKey) : null,
          baseUrl: env?.baseUrl ?? null,
          workspaceId: env?.workspaceId ?? null,
          problem: null,
        } satisfies CredentialStatus,
      ];
    }),
  ) as Record<KeyedProvider, CredentialStatus>;

  for (const row of credRows) {
    const next: ProviderCredential = { ...credentials[row.provider] };
    const s = status[row.provider];
    if (row.base_url) next.baseUrl = s.baseUrl = row.base_url;
    if (row.workspace_id) next.workspaceId = s.workspaceId = row.workspace_id;
    if (row.api_key_sealed) {
      if (!encryptionKey) {
        s.problem = "SETTINGS_ENCRYPTION_KEY is not set, so the saved key cannot be used";
      } else {
        try {
          next.apiKey = decryptSecret(row.api_key_sealed, encryptionKey, aad(row.provider));
          s.source = "stored";
          s.keyHint = row.key_hint;
        } catch (e) {
          s.problem =
            e instanceof SecretsError
              ? `${e.message}. Enter the key again.`
              : "The saved key could not be read. Enter it again.";
        }
      }
    }
    credentials[row.provider] = next;
  }

  const saved = configRes.data !== null;
  const base = saved
    ? (configRes.data as { config: Omit<LlmSettings, "credentials"> }).config
    : envSettings;
  return {
    settings: LlmSettingsSchema.parse({ ...base, credentials }),
    saved,
    credentials: status,
    updatedAt: (configRes.data as { updated_at: string } | null)?.updated_at ?? null,
  };
}

/**
 * Save an edit from /admin/settings/ai. Writes the config (no secrets) and only the credential
 * fields the update touches; keys are encrypted before they reach the database. Returns which
 * providers' keys changed (for the audit event, never the values).
 */
export async function saveSettings(
  db: Db,
  input: {
    current: LlmSettings;
    update: LlmSettingsUpdate;
    actorId: string;
    encryptionKey: string | undefined;
  },
): Promise<{ settings: LlmSettings; keysChanged: LlmProvider[] }> {
  const next = applyLlmSettingsUpdate(input.current, input.update);
  const { credentials: _omit, ...config } = next;
  const now = new Date().toISOString();

  must(
    await db
      .from("llm_settings")
      .upsert({ id: true, config, updated_by: input.actorId, updated_at: now })
      .select("id")
      .single(),
    "save llm_settings",
  );

  const keysChanged: LlmProvider[] = [];
  for (const [provider, patch] of Object.entries(input.update.credentials ?? {}) as [
    LlmProvider,
    NonNullable<NonNullable<LlmSettingsUpdate["credentials"]>[LlmProvider]>,
  ][]) {
    if (provider === "mock") continue;
    const row: Record<string, unknown> = { provider, updated_by: input.actorId, updated_at: now };
    if (patch.apiKey !== undefined) {
      keysChanged.push(provider);
      if (patch.apiKey === null) {
        row.api_key_sealed = null;
        row.key_hint = null;
      } else {
        if (!input.encryptionKey)
          throw new SecretsError("SETTINGS_ENCRYPTION_KEY must be set to save API keys");
        row.api_key_sealed = encryptSecret(patch.apiKey, input.encryptionKey, aad(provider));
        row.key_hint = keyHint(patch.apiKey);
      }
    }
    if (patch.baseUrl !== undefined) row.base_url = patch.baseUrl;
    if (patch.workspaceId !== undefined) row.workspace_id = patch.workspaceId;
    must(
      await db.from("llm_credentials").upsert(row).select("provider").single(),
      `save credentials for ${provider}`,
    );
  }
  return { settings: next, keysChanged };
}
