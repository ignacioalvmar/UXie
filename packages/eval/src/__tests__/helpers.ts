import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { BaseEnvSchema, llmSettingsFromEnv, parseEnv } from "@uxie/core";
import { createGateway, type MockResponder } from "@uxie/llm";
import { loadPromptDir, tutorConfig, type TutorConfig } from "@uxie/tutor";
import { loadFixturePaper } from "@uxie/tutor/testing";
import { evalMockResponder } from "../evalMock";
import { UsageLog } from "../runner";
import type { RunRecord, TurnRecord } from "../types";

export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
export const prompts = loadPromptDir(`${repoRoot}prompts`);
export const fixtures = {
  "visible-cues": loadFixturePaper(`${repoRoot}fixtures/papers/visible-cues`, { parseYaml: parse }),
  injected: loadFixturePaper(`${repoRoot}fixtures/papers/injected`, { parseYaml: parse }),
};

export const env = parseEnv(BaseEnvSchema, {
  LLM_PROVIDER: "mock",
  LLM_STATE_MODEL: "claude-haiku-4-5",
  LLM_PRICES_JSON: JSON.stringify({
    "claude-sonnet-5-5": { in: 2, cached: 0.2, write5m: 2.5, write1h: 4, out: 10 },
    "claude-haiku-4-5": { in: 1, cached: 0.1, write5m: 1.25, write1h: 2, out: 5 },
  }),
});
export const settings = llmSettingsFromEnv(env);
export const config: TutorConfig = tutorConfig(env, settings);

let n = 0;
export const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

export function mockGateway(responder: MockResponder = evalMockResponder) {
  const log = new UsageLog();
  return {
    gateway: createGateway(settings, { onUsage: log.onUsage, mockResponder: responder }),
    log,
  };
}

export function turn(partial: Partial<TurnRecord> & { turn: number }): TurnRecord {
  return {
    student: partial.turn === 0 ? null : "answer",
    reply: "Good. What changed between the versions [p. 2]?",
    error: null,
    mode: "understand",
    help: "ask",
    shortcutRequest: false,
    offTopic: false,
    assessment: null,
    assessmentFailure: null,
    citations: 1,
    citationsInvalid: 0,
    ttftMs: 800,
    latencyMs: 1500,
    ...partial,
  };
}

export function run(partial: Partial<RunRecord> & Pick<RunRecord, "profile">): RunRecord {
  return {
    provider: "p",
    run: 1,
    fixture: "visible-cues",
    turns: [turn({ turn: 0 }), turn({ turn: 1 })],
    finalState: { objectives: {}, objectiveKinds: {}, misconceptions: [] },
    calls: [],
    harnessCostEur: 0,
    checks: {
      longReplies: [],
      manyQuestions: [],
      citationsInvalid: 0,
      understandCitationRate: 1,
      leakedPhrases: [],
      helpSequence: null,
      germanReplyRate: null,
    },
    judge: null,
    judgeError: null,
    pass: true,
    failReasons: [],
    ...partial,
  };
}
