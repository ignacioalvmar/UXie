import { describe, expect, it } from "vitest";
import type { EnvError } from "../index";
import {
  BaseEnvSchema,
  applyLlmSettingsUpdate,
  llmSettingsFromEnv,
  llmSettingsProblems,
  parseEnv,
  redactLlmSettings,
  type LlmSettings,
} from "../index";

const fromEnv = (vars: Record<string, string>) => llmSettingsFromEnv(parseEnv(BaseEnvSchema, vars));

describe("llmSettingsFromEnv (FR-9.6)", () => {
  it("uses LLM_PROVIDER and LLM_API_KEY for every role by default", () => {
    const s = fromEnv({
      LLM_PROVIDER: "openai",
      LLM_API_KEY: "sk-main",
      LLM_TUTOR_MODEL: "gpt-5.5",
      LLM_STATE_MODEL: "gpt-5.4-mini",
    });
    expect(s.roles).toEqual({
      tutor: { provider: "openai", model: "gpt-5.5" },
      state: { provider: "openai", model: "gpt-5.4-mini" },
      judge: { provider: "openai", model: "gpt-5.5" },
    });
    expect(s.credentials).toEqual({ openai: { apiKey: "sk-main" } });
  });

  it("mixes providers per role with provider-specific keys", () => {
    const s = fromEnv({
      LLM_PROVIDER: "anthropic",
      LLM_API_KEY: "sk-ant",
      LLM_STATE_PROVIDER: "google",
      LLM_STATE_MODEL: "gemini-3.5-flash-lite",
      GEMINI_API_KEY: "g-key",
      LLM_JUDGE_PROVIDER: "openai",
      LLM_JUDGE_MODEL: "gpt-5.5",
      OPENAI_API_KEY: "sk-oai",
      ANTHROPIC_API_KEY: "ignored-because-LLM_API_KEY-wins",
    });
    expect(s.roles.state).toEqual({ provider: "google", model: "gemini-3.5-flash-lite" });
    expect(s.roles.judge.provider).toBe("openai");
    expect(s.credentials).toEqual({
      anthropic: { apiKey: "sk-ant" },
      openai: { apiKey: "sk-oai" },
      google: { apiKey: "g-key" },
    });
    expect(llmSettingsProblems(s)).toEqual([]);
  });

  it("FR-9.1 refuses a role whose provider has no key, naming the provider and roles", () => {
    expect(() =>
      parseEnv(BaseEnvSchema, {
        LLM_PROVIDER: "anthropic",
        LLM_API_KEY: "k",
        LLM_STATE_PROVIDER: "google",
      }),
    ).toThrow(/Google \(Gemini\): an API key is required \(used for state\)/);
    try {
      parseEnv(BaseEnvSchema, { LLM_PROVIDER: "openai" });
    } catch (e) {
      expect((e as EnvError).message).toMatch(
        /OpenAI: an API key is required \(used for tutor, state, judge\)/,
      );
    }
  });

  it("maps the openai_compatible base URL and its key", () => {
    const s = fromEnv({
      LLM_PROVIDER: "openai_compatible",
      LLM_BASE_URL: "http://localhost:11434/v1",
      LLM_API_KEY: "local",
    });
    expect(s.credentials.openai_compatible).toEqual({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "local",
    });
  });

  it("validates SETTINGS_ENCRYPTION_KEY as 32 bytes of base64", () => {
    const ok = Buffer.alloc(32, 7).toString("base64");
    expect(
      parseEnv(BaseEnvSchema, { LLM_PROVIDER: "mock", SETTINGS_ENCRYPTION_KEY: ok })
        .SETTINGS_ENCRYPTION_KEY,
    ).toBe(ok);
    expect(() =>
      parseEnv(BaseEnvSchema, { LLM_PROVIDER: "mock", SETTINGS_ENCRYPTION_KEY: "short" }),
    ).toThrow(/SETTINGS_ENCRYPTION_KEY/);
  });
});

describe("redactLlmSettings / applyLlmSettingsUpdate (FR-9.7)", () => {
  const base: LlmSettings = fromEnv({
    LLM_PROVIDER: "anthropic",
    LLM_API_KEY: "sk-ant-api03-SECRETSECRET-wxyz",
    OPENAI_API_KEY: "sk-proj-OTHERSECRET-abcd",
  });

  it("never exposes keys, only whether one is set and its last four characters", () => {
    const view = redactLlmSettings(base);
    expect(JSON.stringify(view)).not.toContain("SECRET");
    expect(view.credentials.anthropic).toEqual({
      hasApiKey: true,
      keyHint: "…wxyz",
      baseUrl: null,
      workspaceId: null,
    });
    expect(view.roles).toEqual(base.roles);
  });

  it("keeps omitted keys, replaces given ones, removes null ones", () => {
    const next = applyLlmSettingsUpdate(base, {
      roles: { ...base.roles, tutor: { provider: "openai", model: "gpt-5.5" } },
      credentials: { google: { apiKey: "g-new" }, openai: { apiKey: null } },
      effort: "medium",
    });
    expect(next.credentials.anthropic?.apiKey).toBe(base.credentials.anthropic?.apiKey);
    expect(next.credentials.google).toEqual({ apiKey: "g-new" });
    expect(next.credentials.openai).toBeUndefined();
    expect(next.roles.tutor).toEqual({ provider: "openai", model: "gpt-5.5" });
    expect(next.effort).toBe("medium");
    expect(llmSettingsProblems(next)).toEqual(["OpenAI: an API key is required (used for tutor)"]);
  });

  it("rejects invalid edits", () => {
    expect(() => applyLlmSettingsUpdate(base, { maxOutputTokens: -1 })).toThrow();
    expect(() =>
      applyLlmSettingsUpdate(base, {
        roles: { ...base.roles, state: { provider: "google", model: " " } },
      }),
    ).toThrow();
  });
});
