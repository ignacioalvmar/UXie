import type { LlmGateway } from "@uxie/llm";
import {
  TutorEngine,
  TutorError,
  type PromptLoader,
  type TurnStream,
  type TutorConfig,
} from "@uxie/tutor";
import {
  InMemoryConversationRepo,
  InMemoryPaperRepo,
  InMemoryProfileRepo,
  InMemoryUsageRepo,
  type FixturePaper,
} from "@uxie/tutor/testing";
import { mean, percentile, ratio, sum } from "./stats";

/** Scripted messages that fit any paper: questions, partial answers, a request for help. */
export const LOADTEST_MESSAGES = [
  "What is the main finding of this paper?",
  "I think it means people only use what they can see.",
  "Can you give me a hint?",
  "Why did the authors measure it that way?",
  "Hmm, maybe it has to do with the design of the interface?",
  "How could I use this in my own app?",
] as const;

export interface LoadTestOptions {
  gateway: LlmGateway;
  prompts: PromptLoader;
  config: TutorConfig;
  fixture: FixturePaper;
  concurrency: number;
  durationMs: number;
  messages?: readonly string[];
  /** Pause between a reply and the student's next message. */
  thinkMs?: number;
  now?: () => number;
}

export interface LoadTestResult {
  concurrency: number;
  durationMs: number;
  /** Tutor turns started within the duration (opening messages included). */
  turns: number;
  errors: number;
  errorRate: number | null;
  errorCodes: Record<string, number>;
  ttftP50: number | null;
  ttftP95: number | null;
  latencyP95: number | null;
  /** Mean turns per simulated student. */
  turnsPerStudent: number | null;
  costEur: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * N simulated students chatting at once through the real engine (PRD §13.4): each opens a
 * conversation, then sends scripted messages back to back until the duration ends. Reports TTFT
 * percentiles and the error rate; establishes the safe concurrency for a provider.
 */
export async function runLoadTest(o: LoadTestOptions): Promise<LoadTestResult> {
  const now = o.now ?? (() => performance.now());
  const messages = o.messages ?? LOADTEST_MESSAGES;
  let costEur = 0;
  // Count the cost of every successful call (replies, assessments, summaries).
  const g = o.gateway;
  const counted: LlmGateway = {
    modelFor: (purpose) => g.modelFor(purpose),
    stream: (p, opts) => {
      const s = g.stream(p, opts);
      s.done.then(
        (r) => (costEur += r.usage.costEur),
        () => {},
      );
      return s;
    },
    structured: async (p, schema, opts) => {
      const r = await g.structured(p, schema, opts);
      costEur += r.usage.costEur;
      return r;
    },
  };
  const papers = new InMemoryPaperRepo();
  const paper = papers.add({
    versionId: crypto.randomUUID(),
    title: o.fixture.pagesFile.title,
    pages: o.fixture.pagesFile.pages,
    guide: o.fixture.guide,
  });
  const conversations = new InMemoryConversationRepo();
  const engine = new TutorEngine({
    llm: counted,
    papers,
    conversations,
    profiles: new InMemoryProfileRepo(),
    usage: new InMemoryUsageRepo(),
    prompts: o.prompts,
    config: o.config,
  });

  const ttfts: number[] = [];
  const latencies: number[] = [];

  const errorCodes: Record<string, number> = {};
  const perStudent: number[] = [];
  const deadline = now() + o.durationMs;

  const turn = async (start: () => Promise<TurnStream>) => {
    try {
      const res = await (await start()).done;
      if (res.usage?.ttftMs !== undefined) ttfts.push(res.usage.ttftMs);
      if (res.usage) latencies.push(res.usage.latencyMs);
    } catch (e) {
      const code = e instanceof TutorError ? e.code : "internal_error";
      errorCodes[code] = (errorCodes[code] ?? 0) + 1;
    }
  };

  const student = async (i: number) => {
    const studentId = `load-${i}`;
    const conversationId = conversations.create({
      studentId,
      paperVersionId: paper.versionId,
      guide: paper.guide,
      isTest: true,
    }).id;
    let n = 0;
    await turn(() => engine.startConversation(conversationId));
    n++;
    while (now() < deadline) {
      const text = messages[(i + n) % messages.length]!;
      await turn(() =>
        engine.runTurn({
          conversationId,
          studentId,
          clientMessageId: crypto.randomUUID(),
          text,
          event: { type: "message" },
        }),
      );
      n++;
      await engine.maybeSummarizeHistory(conversationId);
      if (o.thinkMs) await sleep(o.thinkMs);
    }
    perStudent.push(n);
  };

  await Promise.all(Array.from({ length: o.concurrency }, (_, i) => student(i)));
  const errors = sum(Object.values(errorCodes));
  const turns = sum(perStudent);
  return {
    concurrency: o.concurrency,
    durationMs: o.durationMs,
    turns,
    errors,
    errorRate: ratio(errors, turns),
    errorCodes,
    ttftP50: percentile(ttfts, 50),
    ttftP95: percentile(ttfts, 95),
    latencyP95: percentile(latencies, 95),
    turnsPerStudent: mean(perStudent),
    costEur,
  };
}

export function renderLoadTest(
  results: LoadTestResult[],
  meta: { provider: string; fixture: string; createdAt: string },
): string {
  const s = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);
  const lines = [
    `# UXie load test: ${meta.provider}`,
    "",
    `${meta.createdAt} · fixture ${meta.fixture} · scripted students send messages back to back (no reading pauses), so this is a worst case for the given number of concurrent students.`,
    "",
    "| Concurrency | Turns | Turns/student | TTFT p50 | TTFT p95 (≤ 10 s; target ≤ 4 s) | Latency p95 | Error rate | Errors | Cost |",
    "|---|---|---|---|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.concurrency} | ${r.turns} | ${r.turnsPerStudent?.toFixed(1) ?? "–"} | ${s(r.ttftP50)} | ${s(r.ttftP95)}${r.ttftP95 !== null && r.ttftP95 > 10_000 ? " ❌" : ""} | ${s(r.latencyP95)} | ${r.errorRate === null ? "–" : `${(r.errorRate * 100).toFixed(1)}%`} | ${
          Object.entries(r.errorCodes)
            .map(([k, v]) => `${k}×${v}`)
            .join(", ") || "–"
        } | €${r.costEur.toFixed(3)} |`,
    ),
    "",
    "Cost covers every model call of the tutor (replies, assessments, history summaries).",
    "",
  ];
  return lines.join("\n");
}
