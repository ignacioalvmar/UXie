import { BaseEnvSchema, parseEnv } from "@uxie/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { LlmError } from "../index";
import {
  acceptsEffort,
  acceptsTemperature,
  costEur,
  createGateway,
  extractJson,
  type MockResponder,
  type PromptParts,
  type UsageEvent,
} from "../index";

const mockEnv = (extra: Record<string, string> = {}) =>
  parseEnv(BaseEnvSchema, {
    LLM_PROVIDER: "mock",
    LLM_TUTOR_MODEL: "tutor-m",
    LLM_STATE_MODEL: "state-m",
    ...extra,
  });

const parts = (text = "hello"): PromptParts => ({
  stablePrefix: "STABLE PREFIX ".repeat(50),
  dynamicSystem: "DYNAMIC",
  messages: [{ role: "user", content: text }],
});

const Schema = z.object({ answer: z.number() });

describe("gateway with the mock provider", () => {
  it("streams text and resolves done with the full text", async () => {
    const gw = createGateway(mockEnv(), { mockResponder: () => "One two three?" });
    const { textStream, done } = gw.stream(parts(), { purpose: "tutor" });
    const chunks: string[] = [];
    for await (const c of textStream) chunks.push(c);
    expect(chunks.join("")).toBe("One two three?");
    expect(chunks.length).toBeGreaterThan(1);
    expect((await done).text).toBe("One two three?");
  });

  it("completes even when nobody reads the text stream (consumed server-side)", async () => {
    const gw = createGateway(mockEnv(), { mockResponder: () => "Done?" });
    expect((await gw.stream(parts(), { purpose: "tutor" }).done).text).toBe("Done?");
  });

  it("selects the state model for assessment and summary, the tutor model otherwise", () => {
    const gw = createGateway(mockEnv());
    expect(gw.modelFor("assessment")).toBe("state-m");
    expect(gw.modelFor("summary")).toBe("state-m");
    expect(gw.modelFor("tutor")).toBe("tutor-m");
    expect(gw.modelFor("eval_judge")).toBe("tutor-m");
  });

  it("M2 simulated cache: write on the first call, read from the second on", async () => {
    const gw = createGateway(mockEnv(), { mockResponder: () => "ok?" });
    const first = (await gw.stream(parts(), { purpose: "tutor" }).done).usage;
    const second = (await gw.stream(parts("next"), { purpose: "tutor" }).done).usage;
    expect(first.cachedInputTokens).toBe(0);
    expect(first.cacheWriteInputTokens).toBeGreaterThan(0);
    expect(second.cachedInputTokens).toBeGreaterThan(0);
  });

  it("structured output parses valid JSON", async () => {
    const gw = createGateway(mockEnv(), { mockResponder: () => '{"answer": 42}' });
    expect((await gw.structured(parts(), Schema, { purpose: "assessment" })).value).toEqual({
      answer: 42,
    });
  });

  it("structured output does one repair retry with the validation error appended", async () => {
    const seen: string[][] = [];
    const responder: MockResponder = (call) => {
      seen.push(call.messages.map((m) => `${m.role}:${m.content}`));
      return call.index === 0 ? '{"answer": "not a number"}' : '{"answer": 7}';
    };
    const events: UsageEvent[] = [];
    const gw = createGateway(mockEnv(), {
      mockResponder: responder,
      onUsage: (e) => events.push(e),
    });
    const res = await gw.structured(parts(), Schema, { purpose: "assessment" });
    expect(res.value).toEqual({ answer: 7 });
    expect(seen).toHaveLength(2);
    expect(seen[1]!.at(-2)).toBe('assistant:{"answer": "not a number"}');
    expect(seen[1]!.at(-1)).toMatch(/^user:Your previous output was invalid/);
    expect(events.map((e) => e.ok)).toEqual([false, true]);
    expect(res.usage.outputTokens).toBe(
      events[0]!.usage.outputTokens + events[1]!.usage.outputTokens,
    );
  });

  it("structured output fails with invalid_output after the repair retry", async () => {
    const gw = createGateway(mockEnv(), { mockResponder: () => "no json here" });
    const error = await gw
      .structured(parts(), Schema, { purpose: "assessment" })
      .catch((e: unknown) => e);
    expect((error as LlmError).code).toBe("invalid_output");
  });

  it("FR-9.3 times out structured calls after timeoutMs", async () => {
    const gw = createGateway(mockEnv(), {
      mockResponder: () => ({ text: '{"answer":1}', delayMs: 500 }),
    });
    const error = await gw
      .structured(parts(), Schema, { purpose: "assessment", timeoutMs: 20 })
      .catch((e: unknown) => e);
    expect((error as LlmError).code).toBe("timeout");
  });

  it("FR-9.3 times out streams after LLM_TIMEOUT_MS and reports a failed call", async () => {
    const events: UsageEvent[] = [];
    const gw = createGateway(mockEnv({ LLM_TIMEOUT_MS: "20" }), {
      mockResponder: () => ({ text: "late", delayMs: 500 }),
      onUsage: (e) => events.push(e),
    });
    const { textStream, done } = gw.stream(parts(), { purpose: "tutor" });
    await expect(done).rejects.toMatchObject({ code: "timeout" });
    await expect(textStream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: "timeout",
    });
    expect(events[0]).toMatchObject({ ok: false, errorCode: "timeout" });
  });

  it("a caller abort maps to aborted", async () => {
    const controller = new AbortController();
    const gw = createGateway(mockEnv(), { mockResponder: () => ({ text: "x", delayMs: 500 }) });
    const { done } = gw.stream(parts(), { purpose: "tutor", signal: controller.signal });
    controller.abort();
    await expect(done).rejects.toMatchObject({ code: "aborted" });
  });

  it("a simulated refusal surfaces as provider_refusal", async () => {
    const gw = createGateway(mockEnv(), {
      mockResponder: () => ({ text: "", finishReason: "content-filter" }),
    });
    await expect(gw.stream(parts(), { purpose: "tutor" }).done).rejects.toMatchObject({
      code: "provider_refusal",
    });
  });

  it("never lets an onUsage failure break a call", async () => {
    const gw = createGateway(mockEnv(), {
      mockResponder: () => "fine?",
      onUsage: () => {
        throw new Error("db down");
      },
    });
    expect((await gw.stream(parts(), { purpose: "tutor" }).done).text).toBe("fine?");
  });
});

describe("openai_compatible adapter", () => {
  it("sends one system message with the stable prefix first and asks for JSON-only output", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        id: "c1",
        object: "chat.completion",
        created: 0,
        model: "llama",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '```json\n{"answer": 3}\n```' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }) as typeof globalThis.fetch;
    const env = parseEnv(BaseEnvSchema, {
      LLM_PROVIDER: "openai_compatible",
      LLM_BASE_URL: "http://localhost:11434/v1",
      LLM_TUTOR_MODEL: "llama",
    });
    const res = await createGateway(env, { fetch }).structured(parts(), Schema, {
      purpose: "assessment",
    });
    expect(res.value).toEqual({ answer: 3 });
    const messages = bodies[0]!.messages as { role: string; content: string }[];
    expect(messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content.startsWith(parts().stablePrefix)).toBe(true);
    expect(messages[0]!.content).toContain("Respond with JSON only");
    expect(messages.at(-1)).toEqual({ role: "user", content: "hello" });
  });
});

describe("capabilities and cost", () => {
  it("omits temperature for Sonnet 5.5 and other sampling-locked models only", () => {
    expect(acceptsTemperature("anthropic", "claude-sonnet-5-5")).toBe(false);
    expect(acceptsTemperature("anthropic", "claude-opus-5-5")).toBe(false);
    expect(acceptsTemperature("anthropic", "claude-haiku-4-5")).toBe(true);
    expect(acceptsTemperature("openai_compatible", "claude-sonnet-5-5")).toBe(true);
  });

  it("sends effort only to Anthropic models that support it", () => {
    expect(acceptsEffort("anthropic", "claude-sonnet-5-5")).toBe(true);
    expect(acceptsEffort("anthropic", "claude-haiku-4-5")).toBe(false);
    expect(acceptsEffort("google", "gemini")).toBe(false);
  });

  it("prices cache writes by TTL and reads at the cached rate (PRD §17.4)", () => {
    const prices = { m: { in: 2, cached: 0.2, write5m: 2.5, write1h: 4, out: 10 } };
    const t = { noCache: 4000, cacheRead: 0, cacheWrite: 20_000, output: 600 };
    // cache miss turn ≈ $0.064 in the PRD estimate
    expect(costEur("m", t, prices, "5m", 1)).toBeCloseTo(0.064, 6);
    expect(costEur("m", t, prices, "1h", 1)).toBeCloseTo(0.094, 6);
    // cache hit turn ≈ $0.018
    expect(
      costEur(
        "m",
        { noCache: 4000, cacheRead: 20_000, cacheWrite: 0, output: 600 },
        prices,
        "5m",
        1,
      ),
    ).toBeCloseTo(0.018, 6);
    expect(costEur("unknown", t, prices, "5m", 1)).toBe(0);
    expect(costEur("m", t, prices, "5m", 0.92)).toBeCloseTo(0.064 * 0.92, 6);
  });

  it("extractJson handles fences and surrounding prose", () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n``` hope that helps')).toEqual({ a: 1 });
    expect(extractJson('prefix {"a":[1,2]} suffix')).toEqual({ a: [1, 2] });
    expect(() => extractJson("nothing")).toThrow();
  });
});
