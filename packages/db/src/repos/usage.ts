import { must, type Db } from "../client";

/** UsageRepo, LlmCallRepo and ProfileRepo ports on Supabase (packages/tutor/ports.ts). */

export class SupabaseUsageRepo {
  constructor(private readonly db: Db) {}

  /** Atomic upsert-increment (`increment_usage`); returns the day's new count. */
  async incrementTurn(studentId: string, day: string): Promise<number> {
    return must(
      await this.db.rpc("increment_usage", { p_student: studentId, p_day: day }),
      "increment usage",
    ) as unknown as number;
  }

  /** Not part of the port: turns used today (FR-9.2). */
  async turnsOn(studentId: string, day: string): Promise<number> {
    const res = await this.db
      .from("usage_daily")
      .select("turns")
      .eq("student_id", studentId)
      .eq("day", day)
      .maybeSingle();
    if (res.error) throw new Error(`usage: ${res.error.message}`);
    return (res.data as { turns: number } | null)?.turns ?? 0;
  }

  /**
   * Not part of the port: turns the student started since `since` (typed messages and button
   * events, test conversations excluded), and the oldest of them, for the per-minute limit.
   */
  async turnsSince(
    studentId: string,
    since: Date,
  ): Promise<{ turns: number; oldest: Date | null }> {
    const res = await this.db.rpc("turns_since", {
      p_student: studentId,
      p_since: since.toISOString(),
    });
    if (res.error) throw new Error(`turns since: ${res.error.message}`);
    const row = (res.data as { turns: number; oldest: string | null }[] | null)?.[0];
    return { turns: row?.turns ?? 0, oldest: row?.oldest ? new Date(row.oldest) : null };
  }
}

export interface DbLlmCall {
  conversationId: string | null;
  purpose: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  costEur: number;
  latencyMs: number;
  ttftMs: number | null;
  ok: boolean;
  errorCode: string | null;
  meta: Record<string, unknown>;
}

export class SupabaseLlmCallRepo {
  constructor(private readonly db: Db) {}

  async record(c: DbLlmCall): Promise<void> {
    const { error } = await this.db.from("llm_calls").insert({
      conversation_id: c.conversationId,
      purpose: c.purpose,
      provider: c.provider,
      model: c.model,
      input_tokens: c.inputTokens,
      output_tokens: c.outputTokens,
      cached_input_tokens: c.cachedInputTokens,
      cache_write_input_tokens: c.cacheWriteInputTokens,
      cost_eur: c.costEur,
      latency_ms: c.latencyMs,
      ttft_ms: c.ttftMs,
      ok: c.ok,
      error_code: c.errorCode,
      meta: c.meta,
    });
    if (error) throw new Error(`record llm call: ${error.message}`);
  }

  /** Not part of the port: month-to-date spend for the ceiling check (FR-9.2). */
  async spendSince(since: Date): Promise<number> {
    const res = await this.db.rpc("spend_since", { p_since: since.toISOString() });
    if (res.error) throw new Error(`spend: ${res.error.message}`);
    return Number(res.data ?? 0);
  }
}

export class SupabaseProfileRepo {
  constructor(private readonly db: Db) {}

  async getTutorContext(studentId: string): Promise<{ projectDescription: string | null }> {
    const row = must(
      await this.db
        .from("profiles")
        .select("project_description")
        .eq("id", studentId)
        .maybeSingle(),
      `profile ${studentId}`,
    ) as { project_description: string | null };
    return { projectDescription: row.project_description };
  }
}

/**
 * Operational alerts to the instructor (PRD §17.3, migration 0008): `claim` succeeds once per kind
 * and period, so concurrent turns send one email; `release` lets the next turn retry after a failed
 * send.
 */
export class AlertRepo {
  constructor(private readonly db: Db) {}

  async claim(kind: string, period: string): Promise<boolean> {
    const res = await this.db.from("alerts_sent").insert({ kind, period });
    if (!res.error) return true;
    if (res.error.code === "23505") return false;
    throw new Error(`alert claim: ${res.error.message}`);
  }

  async release(kind: string, period: string): Promise<void> {
    const res = await this.db.from("alerts_sent").delete().eq("kind", kind).eq("period", period);
    if (res.error) throw new Error(`alert release: ${res.error.message}`);
  }
}
