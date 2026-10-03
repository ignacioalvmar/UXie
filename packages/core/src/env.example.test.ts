import { readFileSync } from "node:fs";
import { parseEnv as parseDotenv } from "node:util";
import { describe, expect, it } from "vitest";
import { BaseEnvSchema, parseEnv } from "./env";

describe(".env.example", () => {
  const raw = parseDotenv(readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"));

  it("is valid against the env schema", () => {
    const env = parseEnv(BaseEnvSchema, raw);
    expect(env.ALLOWED_EMAIL_DOMAINS).toEqual(["thi.de", "studmail.thi.de"]);
    expect(env.LLM_PRICES_JSON["claude-sonnet-5-5"]?.out).toBe(10);
  });

  it("documents every variable in the schema", () => {
    const documented = Object.keys(raw);
    const schemaKeys = [
      ...Object.keys(BaseEnvSchema.shape),
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
    ];
    expect(schemaKeys.filter((k) => !documented.includes(k))).toEqual([]);
  });
});
