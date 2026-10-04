/**
 * Turn limits checked before every generation (FR-9.2, PRD §4.4 step 2). Pure, so the rules are
 * unit-tested; the route gathers the counts. Order: the course-wide spend ceiling first (503,
 * nothing a student can do), then the student's daily and per-minute limits (429).
 */

export type LimitCode = "chat_paused" | "daily_limit" | "rate_limited";

export interface LimitBlock {
  status: 429 | 503;
  code: LimitCode;
  message: string;
  /** When chat opens again (ISO 8601), for the countdown / reset time in the UI. */
  retryAt?: string;
}

export interface LimitInput {
  now: Date;
  spendEur: number;
  ceilingEur: number;
  turnsToday: number;
  dailyLimit: number;
  /** Turns started in the last 60 s and the oldest of them. */
  turnsLastMinute: number;
  oldestInWindow: Date | null;
  perMinuteLimit: number;
  /** A retry of an already saved message: not a new turn for the per-minute window. */
  isRetry: boolean;
}

/** Usage days are UTC dates (`usage_daily.day`), so the daily limit resets at UTC midnight. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export const nextUtcMidnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));

/** The spend ceiling is per calendar month (UTC). */
export const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export const MINUTE_MS = 60_000;

export function checkLimits(i: LimitInput): LimitBlock | null {
  if (i.ceilingEur > 0 && i.spendEur >= i.ceilingEur) {
    return {
      status: 503,
      code: "chat_paused",
      message: "UXie is paused for the whole course right now. You can keep reading.",
    };
  }
  if (i.turnsToday >= i.dailyLimit) {
    return {
      status: 429,
      code: "daily_limit",
      message: "You have reached today's message limit.",
      retryAt: nextUtcMidnight(i.now).toISOString(),
    };
  }
  if (!i.isRetry && i.turnsLastMinute >= i.perMinuteLimit) {
    const oldest = i.oldestInWindow ?? i.now;
    const retryAt = new Date(Math.max(oldest.getTime() + MINUTE_MS, i.now.getTime() + 1000));
    return {
      status: 429,
      code: "rate_limited",
      message: "You are sending messages quickly. Try again in a moment.",
      retryAt: retryAt.toISOString(),
    };
  }
  return null;
}

/** Share of the monthly ceiling at which the instructor is warned by email (PRD §17.3, P1). */
export const SPEND_ALERT_SHARE = 0.8;

/** True once this month's spend reaches 80 % of the ceiling (also past 100 %). No ceiling, no alert. */
export function spendAlertDue(spendEur: number, ceilingEur: number): boolean {
  return ceilingEur > 0 && spendEur >= ceilingEur * SPEND_ALERT_SHARE;
}

/** The alert period: one email per calendar month (UTC), e.g. `2026-10`. */
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
