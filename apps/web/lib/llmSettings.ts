import "server-only";
import { llmSettingsFromEnv } from "@uxie/core";
import { loadEffectiveSettings, type EffectiveSettings } from "@uxie/db";
import { serverEnv } from "./env";
import { serviceDb } from "./supabase/server";

/**
 * Effective inference settings with a 60 s in-process cache (FR-9.6: changes apply to new turns
 * within 60 s). Saving on this instance invalidates immediately; other instances catch up.
 */
const TTL_MS = 60_000;
let cache: { at: number; value: EffectiveSettings } | undefined;

export async function effectiveSettings(
  opts: { fresh?: boolean } = {},
): Promise<EffectiveSettings> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const env = serverEnv();
  const value = await loadEffectiveSettings(
    serviceDb(),
    llmSettingsFromEnv(env),
    env.SETTINGS_ENCRYPTION_KEY,
  );
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateSettings() {
  cache = undefined;
}
