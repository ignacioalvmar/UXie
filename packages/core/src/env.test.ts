import { describe, expect, it } from "vitest";
import { BaseEnvSchema, EnvError, ServerEnvSchema, parseEnv, resolveModels } from "./env";

const dev = { LLM_PROVIDER: "mock" };

describe("parseEnv (PRD §7)", () => {
  it("applies defaults and treats empty strings as unset", () => {
    const env = parseEnv(BaseEnvSchema, { ...dev, LLM_API_KEY: "", STUCK_THRESHOLD: "" });
    expect(env.STUCK_THRESHOLD).toBe(3);
    expect(env.LLM_API_KEY).toBeUndefined();
    expect(env.ALLOWED_EMAIL_DOMAINS).toEqual([]);
    expect(env.LLM_PRICES_JSON).toEqual({});
  });

  it("parses comma-separated domains and price JSON", () => {
    const env = parseEnv(BaseEnvSchema, {
      ...dev,
      ALLOWED_EMAIL_DOMAINS: "thi.de, StudMail.thi.de",
      LLM_PRICES_JSON: '{"m":{"in":2,"cached":0.2,"write5m":2.5,"write1h":4,"out":10}}',
    });
    expect(env.ALLOWED_EMAIL_DOMAINS).toEqual(["thi.de", "studmail.thi.de"]);
    expect(env.LLM_PRICES_JSON.m?.out).toBe(10);
  });

  it("FR-9.1 requires an API key for anthropic", () => {
    expect(() => parseEnv(BaseEnvSchema, { LLM_PROVIDER: "anthropic" })).toThrow(/LLM_API_KEY/);
  });

  it("requires a base URL for openai_compatible", () => {
    expect(() => parseEnv(BaseEnvSchema, { LLM_PROVIDER: "openai_compatible" })).toThrow(
      /LLM_BASE_URL/,
    );
  });

  it("NFR-4 refuses debug logging in production", () => {
    expect(() =>
      parseEnv(BaseEnvSchema, {
        NODE_ENV: "production",
        LOG_LEVEL: "debug",
        LLM_PROVIDER: "anthropic",
        LLM_API_KEY: "k",
        ALLOWED_EMAIL_DOMAINS: "thi.de",
      }),
    ).toThrow(/LOG_LEVEL/);
  });

  it("reports every problem by variable name without echoing values", () => {
    try {
      parseEnv(ServerEnvSchema, { ...dev, STUCK_THRESHOLD: "zero", SUPABASE_SECRET_KEY: "s3cret" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const msg = (e as EnvError).message;
      expect(msg).toContain("STUCK_THRESHOLD");
      expect(msg).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(msg).not.toContain("s3cret");
    }
  });

  it("falls back to the tutor model for state and judge", () => {
    const env = parseEnv(BaseEnvSchema, { ...dev, LLM_TUTOR_MODEL: "t" });
    expect(resolveModels(env)).toEqual({ tutor: "t", state: "t", judge: "t" });
  });
});
