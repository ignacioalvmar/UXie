import { LLM_ROLES, type BaseEnv, type LlmSettings } from "@uxie/core";

/**
 * Launch readiness (PRD §17.3, M10): the checklist items that can be verified from the production
 * configuration and database. Pure, so the rules are unit-tested; `doctor --launch` gathers the
 * facts. Everything else stays on the manual list printed after the checks.
 */

export type CheckLevel = "ok" | "warn" | "fail";
export interface LaunchCheck {
  level: CheckLevel;
  what: string;
  detail: string;
}

export interface LaunchFacts {
  env: BaseEnv;
  supabaseUrl: string | null;
  /** The effective model settings (database settings page over env). */
  settings: LlmSettings;
  /** Text of apps/web/content/privacy-notice.md. */
  privacyNotice: string;
  /** Published papers whose current version has an approved guide; null when the DB is unknown. */
  readyPapers: number | null;
  /** Age of the newest worker heartbeat in ms; null when none. */
  heartbeatAgeMs: number | null;
}

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/;
const HEARTBEAT_STALE_MS = 2 * 60_000; // as /admin/health (FR-9.5)

export function launchChecks(f: LaunchFacts): LaunchCheck[] {
  const out: LaunchCheck[] = [];
  const check = (
    pass: boolean,
    what: string,
    ok: string,
    problem: string,
    level: CheckLevel = "fail",
  ) => out.push(pass ? { level: "ok", what, detail: ok } : { level, what, detail: problem });
  const { env } = f;

  check(
    env.APP_URL.startsWith("https://") && !LOCAL.test(env.APP_URL),
    "domain",
    env.APP_URL,
    `APP_URL is ${env.APP_URL}; set the production https://uxie.<domain> URL`,
  );
  check(env.NODE_ENV === "production", "node env", "production", `NODE_ENV is ${env.NODE_ENV}`);
  check(
    !!f.supabaseUrl && !LOCAL.test(f.supabaseUrl),
    "supabase",
    f.supabaseUrl ?? "",
    "NEXT_PUBLIC_SUPABASE_URL is not a hosted project (NFR-5: separate dev and prod projects)",
  );
  check(
    env.ALLOWED_EMAIL_DOMAINS.length > 0,
    "domains",
    env.ALLOWED_EMAIL_DOMAINS.join(", "),
    "ALLOWED_EMAIL_DOMAINS is empty: anyone could register (FR-1.1)",
  );

  const mockRoles = LLM_ROLES.filter((r) => f.settings.roles[r].provider === "mock");
  check(
    mockRoles.length === 0,
    "provider",
    LLM_ROLES.map((r) => `${r}: ${f.settings.roles[r].provider} ${f.settings.roles[r].model}`).join(
      "; ",
    ),
    `the mock model is configured for ${mockRoles.join(", ")}`,
  );
  const unpriced = LLM_ROLES.map((r) => f.settings.roles[r])
    .filter((r) => r.provider !== "mock" && !f.settings.prices[r.model])
    .map((r) => r.model);
  check(
    unpriced.length === 0,
    "prices",
    "every configured model has a price",
    `no LLM_PRICES_JSON entry for ${[...new Set(unpriced)].join(", ")}: costs and the ceiling would read €0`,
  );
  check(
    env.MONTHLY_SPEND_CEILING_EUR > 0,
    "ceiling",
    `€${env.MONTHLY_SPEND_CEILING_EUR} per month`,
    "MONTHLY_SPEND_CEILING_EUR is 0: no spend ceiling (FR-9.2)",
  );
  check(
    !!env.ALERT_EMAIL,
    "alerts",
    `spend alerts at 80 % go to ${env.ALERT_EMAIL}`,
    "ALERT_EMAIL is empty: nobody is warned before the ceiling stops chat",
    "warn",
  );
  check(
    !!env.SMTP_URL && !!env.MAIL_FROM,
    "smtp",
    `app mail from ${env.MAIL_FROM}`,
    "SMTP_URL/MAIL_FROM not set: deletion confirmations and spend alerts are not sent by the app",
    "warn",
  );
  check(
    !!env.SETTINGS_ENCRYPTION_KEY,
    "secrets",
    "SETTINGS_ENCRYPTION_KEY set",
    "SETTINGS_ENCRYPTION_KEY missing: provider keys cannot be saved on /admin/settings/ai",
    "warn",
  );
  check(
    !!env.RETENTION_REVIEW_DATE,
    "retention",
    `review on ${env.RETENTION_REVIEW_DATE}`,
    "RETENTION_REVIEW_DATE not set: no reminder to purge (FR-8.4, D8)",
    "warn",
  );

  const placeholders = f.privacyNotice.match(/\[[^\]\n]{2,}\]/g) ?? [];
  const draft = /\*\*Draft\./.test(f.privacyNotice);
  check(
    !draft && placeholders.length === 0,
    "privacy",
    "privacy notice completed",
    draft
      ? `the privacy notice is still the draft (${placeholders.length} bracketed parts to fill)`
      : `privacy notice has bracketed parts: ${placeholders.slice(0, 3).join(" ")}`,
  );

  if (f.readyPapers !== null)
    check(
      f.readyPapers >= 3,
      "papers",
      `${f.readyPapers} published papers with an approved guide`,
      `${f.readyPapers} published paper(s) with an approved guide; the checklist asks for at least 3`,
    );
  check(
    f.heartbeatAgeMs !== null && f.heartbeatAgeMs < HEARTBEAT_STALE_MS,
    "worker",
    `heartbeat ${Math.round((f.heartbeatAgeMs ?? 0) / 1000)} s ago`,
    f.heartbeatAgeMs === null
      ? "no worker heartbeat: is the Render worker deployed?"
      : `worker heartbeat is ${Math.round(f.heartbeatAgeMs / 60_000)} min old`,
  );
  return out;
}

/** §17.3 items no program can verify; printed after the checks. */
export const MANUAL_LAUNCH_ITEMS = [
  "Production provider confirmed by the M4 benchmark and an accepted ADR (ADR-023 is still 'proposed')",
  "Provider terms reviewed (region, retention, no training); reflected in the privacy notice",
  "Privacy notice and research consent approved (DPO / ethics); controller named",
  "DPAs accepted: Vercel, Render, Supabase, email provider, Anthropic (and any other provider used)",
  "DNS: CNAME uxie → Vercel; SPF, DKIM, DMARC verified in the headers of a real verification email",
  "Supabase Auth: Site URL + redirect allow-list = production URL; custom SMTP; leaked-password protection",
  "HTTPS, verification and password reset tested in production",
  "≥ 3 real papers: extraction reviewed, guides approved, test-chatted by the instructor",
  "Eval thresholds (§1.6) met on the production provider with the production prompts",
  "RLS, permissions, exports, deletion verified on the production-like (dev) project",
  "Accessibility: axe suite green (CI) + manual keyboard and NVDA/VoiceOver pass",
  "Backup restore drill done; rollback drill done; runbook complete",
];
