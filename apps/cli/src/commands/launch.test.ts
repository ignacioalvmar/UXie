import { describe, expect, it } from "vitest";
import { BaseEnvSchema, llmSettingsFromEnv, parseEnv } from "@uxie/core";
import { launchChecks, type LaunchFacts } from "./launch";

const PRICES =
  '{"claude-sonnet-5-5":{"in":2,"cached":0.2,"write5m":2.5,"write1h":4,"out":10},"claude-haiku-4-5":{"in":1,"cached":0.1,"write5m":1.25,"write1h":2,"out":5}}';

const prodEnv = {
  NODE_ENV: "production",
  APP_URL: "https://uxie.example.org",
  ALLOWED_EMAIL_DOMAINS: "thi.de,studmail.thi.de",
  LLM_PROVIDER: "anthropic",
  LLM_API_KEY: "sk-test",
  LLM_PRICES_JSON: PRICES,
  ALERT_EMAIL: "owner@thi.de",
  SMTP_URL: "smtps://u:p@smtp.example.org:465",
  MAIL_FROM: "UXie <uxie@example.org>",
  SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  RETENTION_REVIEW_DATE: "2027-09-30",
};

function facts(over: Record<string, string> = {}, more: Partial<LaunchFacts> = {}): LaunchFacts {
  const env = parseEnv(BaseEnvSchema, { ...prodEnv, ...over });
  return {
    env,
    supabaseUrl: "https://abc.supabase.co",
    settings: llmSettingsFromEnv(env),
    privacyNotice: "## Privacy notice\n\nController: THI, Esplanade 10, Ingolstadt.",
    readyPapers: 3,
    heartbeatAgeMs: 30_000,
    ...more,
  };
}

const levels = (f: LaunchFacts) =>
  Object.fromEntries(launchChecks(f).map((c) => [c.what, c.level]));

describe("PRD §17.3 launch readiness checks", () => {
  it("a complete production configuration passes", () => {
    expect(launchChecks(facts()).filter((c) => c.level !== "ok")).toEqual([]);
  });

  it("fails on localhost, local Supabase, the mock model and a draft privacy notice", () => {
    const l = levels(
      facts(
        { APP_URL: "http://localhost:3000", NODE_ENV: "test", LLM_PROVIDER: "mock" },
        {
          supabaseUrl: "http://127.0.0.1:54321",
          privacyNotice:
            "**Draft. The owner completes…** [Technische Hochschule Ingolstadt, address]",
        },
      ),
    );
    expect(l).toMatchObject({
      domain: "fail",
      "node env": "fail",
      supabase: "fail",
      provider: "fail",
      privacy: "fail",
    });
  });

  it("flags bracketed placeholders even without the draft banner", () => {
    const c = launchChecks(facts({}, { privacyNotice: "Contact: [email]." })).find(
      (x) => x.what === "privacy",
    );
    expect(c).toMatchObject({ level: "fail", detail: expect.stringContaining("[email]") });
  });

  it("fails without prices or a ceiling; warns without alerts, SMTP or retention date", () => {
    const l = levels(
      facts({
        LLM_PRICES_JSON: "{}",
        MONTHLY_SPEND_CEILING_EUR: "0",
        ALERT_EMAIL: "",
        SMTP_URL: "",
        MAIL_FROM: "",
        RETENTION_REVIEW_DATE: "",
      }),
    );
    expect(l).toMatchObject({
      prices: "fail",
      ceiling: "fail",
      alerts: "warn",
      smtp: "warn",
      retention: "warn",
    });
  });

  it("needs three ready papers and a fresh worker heartbeat", () => {
    expect(levels(facts({}, { readyPapers: 2 })).papers).toBe("fail");
    expect(levels(facts({}, { heartbeatAgeMs: 5 * 60_000 })).worker).toBe("fail");
    expect(levels(facts({}, { heartbeatAgeMs: null })).worker).toBe("fail");
    expect(levels(facts({}, { readyPapers: null })).papers).toBeUndefined();
  });
});
