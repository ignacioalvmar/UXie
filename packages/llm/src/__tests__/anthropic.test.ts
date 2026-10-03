import { BaseEnvSchema, llmSettingsFromEnv, parseEnv } from "@uxie/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGateway, LlmError, type PromptParts, type UsageEvent } from "../index";

const settingsFrom = (vars: Record<string, string>) =>
  llmSettingsFromEnv(parseEnv(BaseEnvSchema, vars));

const env = (extra: Record<string, string> = {}) =>
  settingsFrom({
    LLM_PROVIDER: "anthropic",
    LLM_API_KEY: "test-key",
    LLM_TUTOR_MODEL: "claude-sonnet-5-5",
    LLM_STATE_MODEL: "claude-haiku-4-5",
    LLM_PRICES_JSON:
      '{"claude-sonnet-5-5":{"in":2,"cached":0.2,"write5m":2.5,"write1h":4,"out":10},"claude-haiku-4-5":{"in":1,"cached":0.1,"write5m":1.25,"write1h":2,"out":5}}',
    USD_TO_EUR: "1",
    ...extra,
  });

const parts: PromptParts = {
  stablePrefix: "RULES + PAPER + GUIDE",
  dynamicSystem: "MODE + STATE + HELP",
  messages: [{ role: "user", content: "student text" }],
};

const sse = (events: object[]) =>
  events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");

function streamBody(text: string, stopReason = "end_turn") {
  return sse([
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 2000,
          output_tokens: 1,
        },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 50 },
    },
    { type: "message_stop" },
  ]);
}

/** Fake fetch that records request bodies and replies with the given responses in order. */
function fakeFetch(responses: ((body: Record<string, unknown>) => Response)[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    const next = responses[Math.min(bodies.length - 1, responses.length - 1)]!;
    return next(body);
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

const sseResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/event-stream" } });

/** A non-streaming reply; answers through the JSON tool if the SDK used one. */
function jsonMessage(value: unknown) {
  return (body: Record<string, unknown>) => {
    const tools = (body.tools as { name: string }[] | undefined) ?? [];
    const content = tools.length
      ? [{ type: "tool_use", id: "t1", name: tools[0]!.name, input: value }]
      : [{ type: "text", text: JSON.stringify(value) }];
    return Response.json({
      id: "msg_2",
      type: "message",
      role: "assistant",
      model: body.model,
      content,
      stop_reason: tools.length ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 40,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
  };
}

describe("anthropic adapter (PRD §8.3)", () => {
  it("puts the cache breakpoint on the stable prefix only, omits temperature for Sonnet 5.5, sends effort", async () => {
    const { fetch, bodies } = fakeFetch([
      () => sseResponse(streamBody("Hello [p. 1]. What do you think?")),
    ]);
    const gw = createGateway(env({ LLM_TEMPERATURE: "0.3", LLM_EFFORT: "low" }), { fetch });
    const { done } = gw.stream(parts, { purpose: "tutor" });
    await done;

    const body = bodies[0]!;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body).not.toHaveProperty("temperature");
    const system = body.system as { type: string; text: string; cache_control?: object }[];
    expect(system).toHaveLength(2);
    expect(system[0]).toMatchObject({
      text: parts.stablePrefix,
      cache_control: { type: "ephemeral" },
    });
    expect(system[1]!.text).toBe(parts.dynamicSystem);
    expect(system[1]).not.toHaveProperty("cache_control");
    expect(JSON.stringify(body)).toContain('"effort":"low"');
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "student text" }] },
    ]);
  });

  it("uses the 1h cache TTL when configured", async () => {
    const { fetch, bodies } = fakeFetch([() => sseResponse(streamBody("Hi?"))]);
    await createGateway(env({ LLM_CACHE_TTL: "1h" }), { fetch }).stream(parts, { purpose: "tutor" })
      .done;
    const system = bodies[0]!.system as { cache_control?: object }[];
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("forwards temperature to models that accept it and never sends effort to Haiku 4.5", async () => {
    const { fetch, bodies } = fakeFetch([jsonMessage({ ok: true })]);
    const gw = createGateway(env({ LLM_TEMPERATURE: "0.2" }), { fetch });
    await gw.structured(parts, z.object({ ok: z.boolean() }), { purpose: "assessment" });
    expect(bodies[0]!.model).toBe("claude-haiku-4-5");
    expect(bodies[0]!.temperature).toBe(0.2);
    expect(JSON.stringify(bodies[0])).not.toContain("effort");
  });

  it("reports cache reads separately and prices them", async () => {
    const events: UsageEvent[] = [];
    const { fetch } = fakeFetch([() => sseResponse(streamBody("Hello?"))]);
    const gw = createGateway(env(), { fetch, onUsage: (e) => events.push(e) });
    const { usage } = await gw.stream(parts, {
      purpose: "tutor",
      conversationId: "c1",
      annotate: () => ({ citation_invalid: 0 }),
    }).done;
    expect(usage).toMatchObject({
      cachedInputTokens: 2000,
      cacheWriteInputTokens: 0,
      outputTokens: 50,
      provider: "anthropic",
    });
    // 100 × $2 + 2000 × $0.20 + 50 × $10 per MTok = $0.0011
    expect(usage.costEur).toBeCloseTo(0.0011, 6);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      purpose: "tutor",
      ok: true,
      conversationId: "c1",
      meta: { citation_invalid: 0 },
    });
  });

  it("maps stop_reason refusal to a non-retryable provider_refusal error", async () => {
    const events: UsageEvent[] = [];
    const { fetch } = fakeFetch([() => sseResponse(streamBody("", "refusal"))]);
    const gw = createGateway(env(), { fetch, onUsage: (e) => events.push(e) });
    const { done } = gw.stream(parts, { purpose: "tutor" });
    const error = await done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe("provider_refusal");
    expect((error as LlmError).retryable).toBe(false);
    expect(events[0]).toMatchObject({ ok: false, errorCode: "provider_refusal" });
  });

  it("maps HTTP 429 after the retry to rate_limited", async () => {
    const { fetch, bodies } = fakeFetch([
      () =>
        Response.json(
          { type: "error", error: { type: "rate_limit_error", message: "slow down" } },
          { status: 429, headers: { "retry-after-ms": "1" } },
        ),
    ]);
    const error = await createGateway(env(), { fetch })
      .stream(parts, { purpose: "tutor" })
      .done.catch((e: unknown) => e);
    expect((error as LlmError).code).toBe("rate_limited");
    expect(bodies).toHaveLength(2); // FR-9.3: exactly one retry
  });
});

describe("auth errors", () => {
  it("maps HTTP 401 to auth_failed without retrying", async () => {
    const { fetch, bodies } = fakeFetch([
      () =>
        Response.json(
          { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
          { status: 401 },
        ),
    ]);
    const error = await createGateway(env(), { fetch })
      .stream(parts, { purpose: "tutor" })
      .done.catch((e: unknown) => e);
    expect((error as LlmError).code).toBe("auth_failed");
    expect((error as LlmError).retryable).toBe(false);
    expect(bodies).toHaveLength(1);
  });
});

describe("workspace id", () => {
  it("sends anthropic-workspace-id when configured (org-level keys)", async () => {
    const headers: Headers[] = [];
    const fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      return sseResponse(streamBody("Hi?"));
    }) as typeof globalThis.fetch;
    await createGateway(env({ ANTHROPIC_WORKSPACE_ID: "wrkspc_123" }), { fetch }).stream(parts, {
      purpose: "tutor",
    }).done;
    expect(headers[0]!.get("anthropic-workspace-id")).toBe("wrkspc_123");
    await createGateway(env(), { fetch }).stream(parts, { purpose: "tutor" }).done;
    expect(headers[1]!.get("anthropic-workspace-id")).toBeNull();
  });
});
