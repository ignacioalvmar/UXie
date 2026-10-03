import { BaseEnvSchema, llmSettingsFromEnv, parseEnv } from "@uxie/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  acceptsEffort,
  acceptsTemperature,
  createGateway,
  isGeminiThinkingLevelModel,
  isOpenAIReasoningModel,
  MODEL_CATALOG,
  openaiReasoningEffort,
  type PromptParts,
  type UsageEvent,
} from "../index";

const settingsFrom = (vars: Record<string, string>) =>
  llmSettingsFromEnv(parseEnv(BaseEnvSchema, vars));

const parts: PromptParts = {
  stablePrefix: "RULES + PAPER + GUIDE",
  dynamicSystem: "MODE + STATE + HELP",
  messages: [{ role: "user", content: "student text" }],
};
const Schema = z.object({ answer: z.number() });

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

/** Fake fetch: records requests; answers each with `reply(url, body)`. */
function fakeFetch(reply: (url: string, body: Record<string, unknown>) => Response) {
  const requests: Captured[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url, body });
    return reply(url, body);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

/** OpenAI Responses API reply with output text. */
const openaiResponse = (text: string, cached = 0) =>
  Response.json({
    id: "resp_1",
    object: "response",
    created_at: 1,
    status: "completed",
    model: "gpt-5.5",
    output: [
      {
        id: "msg_1",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: cached },
      output_tokens: 20,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 1020,
    },
  });

/** Gemini generateContent reply with text. */
const geminiResponse = (text: string) =>
  Response.json({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: {
      promptTokenCount: 800,
      cachedContentTokenCount: 600,
      candidatesTokenCount: 12,
      totalTokenCount: 812,
    },
    modelVersion: "gemini-3.8-flash",
  });

describe("openai adapter (Responses API)", () => {
  const settings = settingsFrom({
    LLM_PROVIDER: "openai",
    LLM_API_KEY: "sk-test",
    LLM_TUTOR_MODEL: "gpt-5.5",
    LLM_STATE_MODEL: "gpt-5.4-mini",
    LLM_TEMPERATURE: "0.3",
    LLM_EFFORT: "max",
  });

  it("sends store:false, a prefix-derived prompt cache key, reasoning effort and no temperature", async () => {
    const { fetch, requests } = fakeFetch(() => openaiResponse('{"answer": 1}', 512));
    const events: UsageEvent[] = [];
    const gw = createGateway(settings, { fetch, onUsage: (e) => events.push(e) });
    const res = await gw.structured(parts, Schema, { purpose: "guide_draft" });
    expect(res.value).toEqual({ answer: 1 });

    const { url, body } = requests[0]!;
    expect(url).toMatch(/\/responses$/);
    expect(body.model).toBe("gpt-5.5");
    expect(body.store).toBe(false);
    expect(body.prompt_cache_key).toMatch(/^uxie-[0-9a-f]{12}$/);
    expect(body).not.toHaveProperty("temperature"); // reasoning model
    const input = body.input as { role: string; content: unknown }[];
    expect(JSON.stringify(input[0])).toContain("RULES + PAPER + GUIDE\\n\\nMODE + STATE + HELP");
    expect(input.at(-1)).toMatchObject({ role: "user" });
    expect(res.usage).toMatchObject({
      provider: "openai",
      cachedInputTokens: 512,
      inputTokens: 1000,
    });
    expect(events[0]?.usage.provider).toBe("openai");
  });

  it("uses reasoning effort for tutor replies (max → high before GPT-6) and the same cache key every turn", async () => {
    const { fetch, requests } = fakeFetch(() => new Response("{}", { status: 400 }));
    const gw = createGateway(settings, { fetch });
    await gw.stream(parts, { purpose: "tutor" }).done.catch(() => {});
    await gw
      .stream({ ...parts, dynamicSystem: "OTHER TURN" }, { purpose: "tutor" })
      .done.catch(() => {});
    expect(requests[0]!.body.reasoning).toMatchObject({ effort: "high" });
    expect(requests[0]!.body.prompt_cache_key).toBe(requests[1]!.body.prompt_cache_key);
    expect(requests[0]!.body.stream).toBe(true);
  });
});

describe("google adapter (Gemini)", () => {
  const settings = settingsFrom({
    LLM_PROVIDER: "google",
    LLM_API_KEY: "g-test",
    LLM_TUTOR_MODEL: "gemini-3.8-flash",
    LLM_EFFORT: "max",
    LLM_TEMPERATURE: "0.4",
  });

  it("sends one system instruction with the prefix first, the thinking level and the temperature", async () => {
    const { fetch, requests } = fakeFetch(() => new Response("{}", { status: 400 }));
    await createGateway(settings, { fetch })
      .stream(parts, { purpose: "tutor" })
      .done.catch(() => {});
    const { url, body } = requests[0]!;
    expect(url).toContain("gemini-3.8-flash");
    expect(JSON.stringify(body.systemInstruction)).toContain(
      "RULES + PAPER + GUIDE\\n\\nMODE + STATE + HELP",
    );
    const config = body.generationConfig as Record<string, unknown>;
    expect(config.thinkingConfig).toMatchObject({ thinkingLevel: "high" });
    expect(config.temperature).toBe(0.4);
  });

  it("parses structured output and reports Gemini cache reads", async () => {
    const { fetch, requests } = fakeFetch(() => geminiResponse('{"answer": 2}'));
    const res = await createGateway(settings, { fetch }).structured(parts, Schema, {
      purpose: "assessment",
    });
    expect(res.value).toEqual({ answer: 2 });
    expect(res.usage).toMatchObject({ provider: "google", cachedInputTokens: 600 });
    const config = requests[0]!.body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config).not.toHaveProperty("thinkingConfig"); // only tutor replies set a thinking level
  });
});

describe("mixed providers per role (FR-9.6)", () => {
  it("routes each purpose to its role's provider and reports usage per provider", async () => {
    const settings = settingsFrom({
      LLM_PROVIDER: "openai",
      LLM_API_KEY: "sk-test",
      LLM_TUTOR_MODEL: "gpt-5.5",
      LLM_STATE_PROVIDER: "google",
      LLM_STATE_MODEL: "gemini-3.5-flash-lite",
      GEMINI_API_KEY: "g-test",
    });
    const { fetch, requests } = fakeFetch((url) =>
      url.includes("generativelanguage")
        ? geminiResponse('{"answer": 3}')
        : openaiResponse('{"answer": 4}'),
    );
    const events: UsageEvent[] = [];
    const gw = createGateway(settings, { fetch, onUsage: (e) => events.push(e) });
    expect((await gw.structured(parts, Schema, { purpose: "assessment" })).value).toEqual({
      answer: 3,
    });
    expect((await gw.structured(parts, Schema, { purpose: "guide_draft" })).value).toEqual({
      answer: 4,
    });
    expect(requests.map((r) => new URL(r.url).host)).toEqual([
      "generativelanguage.googleapis.com",
      "api.openai.com",
    ]);
    expect(events.map((e) => `${e.purpose}:${e.usage.provider}:${e.usage.model}`)).toEqual([
      "assessment:google:gemini-3.5-flash-lite",
      "guide_draft:openai:gpt-5.5",
    ]);
  });
});

describe("capabilities for OpenAI and Gemini", () => {
  it.each([
    ["o3", true],
    ["o4-mini", true],
    ["gpt-5", true],
    ["gpt-5.5", true],
    ["gpt-5.4-mini", true],
    ["gpt-6-sol", true],
    ["gpt-5-chat-latest", false],
    ["gpt-4.1", false],
    ["gpt-4o-mini", false],
  ])("%s reasoning model: %s", (model, reasoning) => {
    expect(isOpenAIReasoningModel(model)).toBe(reasoning);
    expect(acceptsTemperature("openai", model)).toBe(!reasoning);
    expect(acceptsEffort("openai", model)).toBe(reasoning);
  });

  it("maps effort for OpenAI and gates Gemini thinking levels to Gemini 3+", () => {
    expect(openaiReasoningEffort("max", "gpt-5.5")).toBe("high");
    expect(openaiReasoningEffort("max", "gpt-6-sol")).toBe("max");
    expect(openaiReasoningEffort("low", "gpt-5.5")).toBe("low");
    expect(isGeminiThinkingLevelModel("gemini-3.8-flash")).toBe(true);
    expect(isGeminiThinkingLevelModel("gemini-2.5-pro")).toBe(false);
    expect(isGeminiThinkingLevelModel("gemini-pro-latest")).toBe(false);
    expect(acceptsTemperature("google", "gemini-3.8-flash")).toBe(true);
  });

  it("the catalog lists every provider and only the prices it can source", () => {
    const providers = new Set(MODEL_CATALOG.map((m) => m.provider));
    expect([...providers]).toEqual(["anthropic", "openai", "google"]);
    for (const m of MODEL_CATALOG) {
      if (m.provider !== "anthropic") expect(m.price).toBeNull();
    }
    expect(MODEL_CATALOG.find((m) => m.model === "claude-sonnet-5-5")?.price).toEqual({
      in: 2,
      cached: 0.2,
      write5m: 2.5,
      write1h: 4,
      out: 10,
    });
  });
});

describe("endpoint pinning (NFR-1)", () => {
  it("ignores ambient ANTHROPIC_BASE_URL / OPENAI_BASE_URL so student data cannot be redirected", async () => {
    const saved = { a: process.env.ANTHROPIC_BASE_URL, o: process.env.OPENAI_BASE_URL };
    process.env.ANTHROPIC_BASE_URL = "https://elsewhere.example/v1";
    process.env.OPENAI_BASE_URL = "https://elsewhere.example/v1";
    try {
      const settings = settingsFrom({
        LLM_PROVIDER: "anthropic",
        LLM_API_KEY: "sk-ant-test",
        LLM_STATE_PROVIDER: "openai",
        LLM_STATE_MODEL: "gpt-5.4-mini",
        OPENAI_API_KEY: "sk-test",
      });
      const { fetch, requests } = fakeFetch(() => new Response("{}", { status: 400 }));
      const gw = createGateway(settings, { fetch });
      await gw.stream(parts, { purpose: "tutor" }).done.catch(() => {});
      await gw.stream(parts, { purpose: "summary" }).done.catch(() => {});
      expect(requests.map((r) => new URL(r.url).host)).toEqual([
        "api.anthropic.com",
        "api.openai.com",
      ]);
    } finally {
      process.env.ANTHROPIC_BASE_URL = saved.a;
      process.env.OPENAI_BASE_URL = saved.o;
      if (saved.a === undefined) delete process.env.ANTHROPIC_BASE_URL;
      if (saved.o === undefined) delete process.env.OPENAI_BASE_URL;
    }
  });
});
