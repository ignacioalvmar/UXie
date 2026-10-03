"use server";

import {
  applyLlmSettingsUpdate,
  describeLlmSettings,
  llmSettingsProblems,
  LlmSettingsUpdateSchema,
} from "@uxie/core";
import { saveSettings, SecretsError } from "@uxie/db";
import { pingRoles, type RolePing } from "@uxie/llm";
import { accounts, requireInstructor } from "../../../../lib/auth";
import { serverEnv } from "../../../../lib/env";
import { effectiveSettings, invalidateSettings } from "../../../../lib/llmSettings";
import { serviceDb } from "../../../../lib/supabase/server";

export type SettingsResult =
  { ok: true; pings?: RolePing[] } | { ok: false; problems: string[]; pings?: RolePing[] };

function parse(update: unknown) {
  const parsed = LlmSettingsUpdateSchema.safeParse(update);
  if (!parsed.success)
    return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } as const;
  return { update: parsed.data } as const;
}

/** "Test connection": one tiny request per configured role, with the typed (unsaved) values. */
export async function testAiSettings(update: unknown): Promise<SettingsResult> {
  await requireInstructor();
  const p = parse(update);
  if ("error" in p) return { ok: false, problems: p.error! };
  const current = (await effectiveSettings({ fresh: true })).settings;
  let candidate;
  try {
    candidate = applyLlmSettingsUpdate(current, p.update);
  } catch {
    return { ok: false, problems: ["The settings are not valid."] };
  }
  const problems = llmSettingsProblems(candidate);
  if (problems.length) return { ok: false, problems };
  const pings = await pingRoles(candidate);
  return pings.every((r) => r.ok) ? { ok: true, pings } : { ok: false, problems: [], pings };
}

/** Save (FR-9.6): validate, encrypt keys (FR-9.7), audit event without key values, refresh cache. */
export async function saveAiSettings(update: unknown): Promise<SettingsResult> {
  const { user } = await requireInstructor();
  const p = parse(update);
  if ("error" in p) return { ok: false, problems: p.error! };
  const current = (await effectiveSettings({ fresh: true })).settings;
  let candidate;
  try {
    candidate = applyLlmSettingsUpdate(current, p.update);
  } catch {
    return { ok: false, problems: ["The settings are not valid."] };
  }
  const problems = llmSettingsProblems(candidate);
  if (problems.length) return { ok: false, problems };
  try {
    const { settings, keysChanged } = await saveSettings(serviceDb(), {
      current,
      update: p.update,
      actorId: user.id,
      encryptionKey: serverEnv().SETTINGS_ENCRYPTION_KEY,
    });
    await accounts().logEvent("llm_settings_changed", user.id, {
      roles: describeLlmSettings(settings),
      keys_changed: keysChanged,
    });
  } catch (e) {
    if (e instanceof SecretsError) return { ok: false, problems: [e.message] };
    throw e;
  }
  invalidateSettings();
  return { ok: true };
}
