import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { BaseEnvSchema, parseEnv } from "@uxie/core";
import {
  createGateway,
  defaultMockResponder,
  type MockCall,
  type MockResponder,
  type UsageEvent,
} from "@uxie/llm";
import { loadPromptDir, TutorEngine, type TurnResult, type TutorConfig } from "../index";
import {
  InMemoryConversationRepo,
  InMemoryPaperRepo,
  InMemoryProfileRepo,
  InMemoryUsageRepo,
  loadFixturePaper,
} from "../testing";

export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
export const prompts = loadPromptDir(`${repoRoot}prompts`);
export const fixture = loadFixturePaper(`${repoRoot}fixtures/papers/visible-cues`, {
  parseYaml: parse,
});

export const STUDENT = "student-1";

export interface Harness {
  engine: TutorEngine;
  conversations: InMemoryConversationRepo;
  papers: InMemoryPaperRepo;
  profiles: InMemoryProfileRepo;
  usage: InMemoryUsageRepo;
  calls: MockCall[];
  usageEvents: UsageEvent[];
  conversationId: string;
  /** Replace how the mock answers from now on. */
  respond: (r: MockResponder) => void;
  /** Run one typed student turn to completion. */
  say: (text: string, clientMessageId?: string) => Promise<TurnResult>;
}

let idCounter = 0;
export const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;

export function makeHarness(
  opts: {
    config?: Partial<TutorConfig>;
    env?: Record<string, string>;
    mode?: "understand" | "apply" | "critique" | "build";
  } = {},
): Harness {
  const calls: MockCall[] = [];
  const usageEvents: UsageEvent[] = [];
  let responder: MockResponder = defaultMockResponder;
  const env = parseEnv(BaseEnvSchema, { LLM_PROVIDER: "mock", ...opts.env });
  const llm = createGateway(env, {
    mockResponder: (call) => {
      calls.push(call);
      return responder(call);
    },
    onUsage: (e) => usageEvents.push(e),
  });

  const papers = new InMemoryPaperRepo();
  const paper = papers.add({
    versionId: "11111111-1111-4111-8111-111111111111",
    title: fixture.pagesFile.title,
    pages: fixture.pagesFile.pages,
    guide: fixture.guide,
  });
  const conversations = new InMemoryConversationRepo(nextId);
  const profiles = new InMemoryProfileRepo();
  const usage = new InMemoryUsageRepo();
  const conv = conversations.create({
    studentId: STUDENT,
    paperVersionId: paper.versionId,
    guide: paper.guide,
    mode: opts.mode,
  });

  const engine = new TutorEngine({
    llm,
    papers,
    conversations,
    profiles,
    usage,
    prompts,
    newId: nextId,
    clock: () => new Date("2026-10-15T10:00:00Z"),
    config: {
      stuckThreshold: 3,
      historyTurns: 16,
      tutorLanguage: "mirror",
      contextStrategy: "auto",
      contextWindow: 1_000_000,
      retrievalMaxPages: 8,
      assessmentTimeoutMs: 8000,
      maxOutputTokens: 2000,
      ...opts.config,
    },
  });

  const harness: Harness = {
    engine,
    conversations,
    papers,
    profiles,
    usage,
    calls,
    usageEvents,
    conversationId: conv.id,
    respond: (r) => {
      responder = r;
    },
    say: async (text: string, clientMessageId = nextId()) => {
      const turn = await engine.runTurn({
        conversationId: conv.id,
        studentId: STUDENT,
        clientMessageId,
        text,
        event: { type: "message" },
      });
      return turn.done;
    },
  };
  return harness;
}

/** Responder that returns `assessment` for assessment calls and `reply` for tutor calls. */
export function scripted(
  assessment: object | (() => object),
  reply = "Interesting. Look at [p. 2]. What changed between the versions?",
): MockResponder {
  return (call) => {
    if (call.purpose === "assessment")
      return JSON.stringify(typeof assessment === "function" ? assessment() : assessment);
    return call.purpose === "tutor" ? reply : defaultMockResponder(call);
  };
}

export const partial = {
  intent: "answer",
  answer_quality: "partial",
  objective_updates: [],
  misconception: null,
  misconception_resolved: null,
  language: "en",
};
