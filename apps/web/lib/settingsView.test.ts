import { describe, expect, it } from "vitest";
import { BaseEnvSchema, llmSettingsFromEnv, parseEnv } from "@uxie/core";
import { settingsView } from "./settingsView";

describe("FR-9.7 settings view sent to the browser", () => {
  it("contains no API key, only hints and sources", () => {
    const secret = "sk-ant-api03-very-secret-0123456789wxyz";
    const settings = llmSettingsFromEnv(
      parseEnv(BaseEnvSchema, {
        LLM_PROVIDER: "anthropic",
        LLM_API_KEY: secret,
        LLM_STATE_MODEL: "claude-haiku-4-5",
      }),
    );
    const view = settingsView({
      settings,
      saved: false,
      updatedAt: null,
      credentials: {
        anthropic: {
          source: "env",
          keyHint: "…wxyz",
          baseUrl: null,
          workspaceId: null,
          problem: null,
        },
        openai: { source: null, keyHint: null, baseUrl: null, workspaceId: null, problem: null },
        google: { source: null, keyHint: null, baseUrl: null, workspaceId: null, problem: null },
        openai_compatible: {
          source: null,
          keyHint: null,
          baseUrl: null,
          workspaceId: null,
          problem: null,
        },
      },
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain(secret);
    expect(json).not.toContain("apiKey");
    expect(view.credentials.anthropic.keyHint).toBe("…wxyz");
    // Sonnet 5.5 is sampling-locked: the page disables temperature for it.
    expect(view.temperatureAllowed["anthropic:claude-sonnet-5-5"]).toBe(false);
    expect(view.prices["claude-haiku-4-5"]?.out).toBe(5);
  });
});
