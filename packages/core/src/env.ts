import { z } from "zod";

/**
 * Environment schema (PRD §7). Pure: callers pass `process.env` (or any record) in.
 * Empty strings are treated as "not set", so `.env` lines like `LLM_API_KEY=` behave as absent.
 */

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
const withDefault = <T extends z.ZodType>(schema: T, fallback: z.input<T>) =>
  z.preprocess(blankToUndefined, schema.prefault(fallback as never));

const int = z.coerce.number().int();
const csv = z.string().transform((s) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
);

export const PriceSchema = z.object({
  in: z.number().nonnegative(),
  cached: z.number().nonnegative(),
  write5m: z.number().nonnegative(),
  write1h: z.number().nonnegative(),
  out: z.number().nonnegative(),
});
export type Price = z.infer<typeof PriceSchema>;

const pricesJson = z.string().transform((s, ctx) => {
  try {
    return z.record(z.string(), PriceSchema).parse(JSON.parse(s));
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "must be JSON: {model: {in, cached, write5m, write1h, out}}",
    });
    return z.NEVER;
  }
});

export const LlmProvider = z.enum(["anthropic", "openai_compatible", "google", "mock"]);
export type LlmProvider = z.infer<typeof LlmProvider>;

/** Variables shared by every process (web, worker, CLI, eval). */
export const BaseEnvSchema = z.object({
  // App
  APP_URL: withDefault(z.url(), "http://localhost:3000"),
  NODE_ENV: withDefault(z.enum(["development", "test", "production"]), "development"),
  LOG_LEVEL: withDefault(z.enum(["trace", "debug", "info", "warn", "error", "fatal"]), "info"),
  ALLOWED_EMAIL_DOMAINS: withDefault(csv, ""),
  REGISTRATION_INVITE_CODE: opt(z.string()),
  PRIVACY_NOTICE_VERSION: withDefault(z.string(), "2026-10-01"),
  RESEARCH_CONSENT_VERSION: withDefault(z.string(), "2026-10-01"),

  // LLM provider
  LLM_PROVIDER: withDefault(LlmProvider, "anthropic"),
  LLM_BASE_URL: opt(z.url()),
  LLM_API_KEY: opt(z.string()),
  LLM_TUTOR_MODEL: withDefault(z.string(), "claude-sonnet-5-5"),
  LLM_STATE_MODEL: opt(z.string()),
  LLM_JUDGE_MODEL: opt(z.string()),
  LLM_CONTEXT_WINDOW: withDefault(int.positive(), 1_000_000),
  LLM_MAX_OUTPUT_TOKENS: withDefault(int.positive(), 2000),
  LLM_EFFORT: withDefault(z.enum(["low", "medium", "high", "max"]), "low"),
  LLM_TEMPERATURE: opt(z.coerce.number().min(0).max(2)),
  LLM_CACHE_TTL: withDefault(z.enum(["5m", "1h"]), "5m"),
  LLM_TIMEOUT_MS: withDefault(int.positive(), 60_000),
  ASSESSMENT_TIMEOUT_MS: withDefault(int.positive(), 8000),
  LLM_PRICES_JSON: withDefault(pricesJson, "{}"),
  USD_TO_EUR: withDefault(z.coerce.number().positive(), 0.92),

  // Tutor behaviour
  STUCK_THRESHOLD: withDefault(int.min(1), 3),
  HISTORY_TURNS: withDefault(int.min(2), 16),
  TUTOR_LANGUAGE: withDefault(z.enum(["mirror", "en"]), "mirror"),
  CONTEXT_STRATEGY: withDefault(z.enum(["auto", "full", "retrieval"]), "auto"),
  RETRIEVAL_MAX_PAGES: withDefault(int.positive(), 8),

  // Limits & cost
  DAILY_TURN_LIMIT: withDefault(int.positive(), 120),
  PER_MINUTE_TURN_LIMIT: withDefault(int.positive(), 8),
  MONTHLY_SPEND_CEILING_EUR: withDefault(z.coerce.number().nonnegative(), 100),
  RETENTION_REVIEW_DATE: opt(z.iso.date()),

  // Ingestion
  EXTRACTOR: withDefault(z.enum(["unpdf", "docling"]), "unpdf"),
  DOCLING_URL: opt(z.url()),
  MAX_PDF_MB: withDefault(int.positive(), 40),
  PAPER_TOKEN_WARN: withDefault(int.positive(), 60_000),

  // Worker
  WORKER_POLL_MS: withDefault(int.positive(), 5000),
  WORKER_JOB_TIMEOUT_MS: withDefault(int.positive(), 900_000),
  ALERT_EMAIL: opt(z.email()),
});

/** Supabase access; required by web, worker and DB-backed CLI commands. */
export const SupabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export const ServerEnvSchema = BaseEnvSchema.extend(SupabaseEnvSchema.shape);

export type BaseEnv = z.infer<typeof BaseEnvSchema>;
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "EnvError";
  }
}

/** Cross-field rules that a per-field schema cannot express. Returns human-readable problems. */
export function envProblems(env: BaseEnv): string[] {
  const problems: string[] = [];
  const prod = env.NODE_ENV === "production";
  if (prod && (env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "trace")) {
    problems.push(
      "LOG_LEVEL: debug/trace may log message content and is not allowed in production (NFR-4)",
    );
  }
  if (prod && env.ALLOWED_EMAIL_DOMAINS.length === 0) {
    problems.push("ALLOWED_EMAIL_DOMAINS: must be set in production (FR-1.1)");
  }
  if (prod && env.LLM_PROVIDER === "mock") {
    problems.push("LLM_PROVIDER: mock is for tests and development only");
  }
  if ((env.LLM_PROVIDER === "anthropic" || env.LLM_PROVIDER === "google") && !env.LLM_API_KEY) {
    problems.push(`LLM_API_KEY: required for LLM_PROVIDER=${env.LLM_PROVIDER}`);
  }
  if (env.LLM_PROVIDER === "openai_compatible" && !env.LLM_BASE_URL) {
    problems.push("LLM_BASE_URL: required for LLM_PROVIDER=openai_compatible");
  }
  if (env.EXTRACTOR === "docling" && !env.DOCLING_URL) {
    problems.push("DOCLING_URL: required for EXTRACTOR=docling");
  }
  return problems;
}

/**
 * Validate a raw environment against a schema. Throws EnvError listing every problem.
 * Error messages name variables, never their values (values may be secrets).
 */
export function parseEnv<S extends typeof BaseEnvSchema | typeof ServerEnvSchema>(
  schema: S,
  source: Record<string, string | undefined>,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const problems = envProblems(result.data);
  if (problems.length) throw new EnvError(problems);
  return result.data as z.infer<S>;
}

/** Effective model per purpose, applying the PRD fallbacks (state → tutor, judge → tutor). */
export function resolveModels(env: BaseEnv) {
  return {
    tutor: env.LLM_TUTOR_MODEL,
    state: env.LLM_STATE_MODEL ?? env.LLM_TUTOR_MODEL,
    judge: env.LLM_JUDGE_MODEL ?? env.LLM_TUTOR_MODEL,
  };
}

/** One-line, secret-free description of the inference setup for boot logs (FR-9.1). */
export function describeEnv(env: BaseEnv) {
  const models = resolveModels(env);
  return {
    provider: env.LLM_PROVIDER,
    tutorModel: models.tutor,
    stateModel: models.state,
    contextWindow: env.LLM_CONTEXT_WINDOW,
    contextStrategy: env.CONTEXT_STRATEGY,
    effort: env.LLM_EFFORT,
    cacheTtl: env.LLM_CACHE_TTL,
  };
}
