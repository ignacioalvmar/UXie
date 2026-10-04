import { describe, expect, it } from "vitest";
import {
  checkLimits,
  monthKey,
  monthStart,
  nextUtcMidnight,
  spendAlertDue,
  type LimitInput,
} from "./limits";

const now = new Date("2026-10-15T10:00:30Z");
const base: LimitInput = {
  now,
  spendEur: 10,
  ceilingEur: 100,
  turnsToday: 5,
  dailyLimit: 120,
  turnsLastMinute: 2,
  oldestInWindow: new Date("2026-10-15T10:00:00Z"),
  perMinuteLimit: 8,
  isRetry: false,
};

describe("FR-9.2 turn limits", () => {
  it("lets a normal turn through", () => {
    expect(checkLimits(base)).toBeNull();
  });

  it("FR-9.2 spend ceiling reached → 503 chat_paused, before anything else", () => {
    const block = checkLimits({ ...base, spendEur: 100, turnsToday: 500 });
    expect(block).toMatchObject({ status: 503, code: "chat_paused" });
  });

  it("a ceiling of 0 disables the check", () => {
    expect(checkLimits({ ...base, ceilingEur: 0, spendEur: 5 })).toBeNull();
  });

  it("FR-9.2 daily limit → 429 daily_limit with the next UTC midnight", () => {
    const block = checkLimits({ ...base, turnsToday: 120 });
    expect(block).toMatchObject({
      status: 429,
      code: "daily_limit",
      retryAt: "2026-10-16T00:00:00.000Z",
    });
  });

  it("FR-9.2 per-minute limit → 429 rate_limited, open again 60 s after the oldest turn", () => {
    const block = checkLimits({ ...base, turnsLastMinute: 8 });
    expect(block).toMatchObject({
      status: 429,
      code: "rate_limited",
      retryAt: "2026-10-15T10:01:00.000Z",
    });
  });

  it("a retry of a saved message is not a new turn for the per-minute window", () => {
    expect(checkLimits({ ...base, turnsLastMinute: 8, isRetry: true })).toBeNull();
  });

  it("date helpers are UTC", () => {
    expect(nextUtcMidnight(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(monthStart(now).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("spend alert at 80 % of the ceiling (PRD §17.3)", () => {
  it("is due from 80 % on, including past the ceiling", () => {
    expect(spendAlertDue(79.99, 100)).toBe(false);
    expect(spendAlertDue(80, 100)).toBe(true);
    expect(spendAlertDue(130, 100)).toBe(true);
  });
  it("never fires without a ceiling", () => {
    expect(spendAlertDue(1000, 0)).toBe(false);
  });
  it("is keyed by UTC calendar month", () => {
    expect(monthKey(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(monthKey(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});
