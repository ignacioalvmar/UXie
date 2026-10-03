import type { UsageEvent, LlmGateway } from "@uxie/llm";
import {
  helpLabel,
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
import {
  createLeakDetector,
  guideHints,
  privateGuideTexts,
  publicGuideTexts,
  runAutoChecks,
} from "./checks";
import { judgeRun } from "./judge";
import type { JudgeVerdict } from "./judgeSchema";
import { evaluatePass } from "./passFail";
import { APPLIER_PROJECT, misconceptionFor, type Profile } from "./profiles";
import { simulateStudent } from "./studentSim";
import { toCallSummary, type CallSummary, type RunRecord, type TurnRecord } from "./types";

/**
 * Collects usage events per conversation. Wire `onUsage` into a gateway; `take` returns the
 * events since the previous `take` for that conversation (so calls can be attributed to turns).
 */
export class UsageLog {
  private pending = new Map<string, UsageEvent[]>();
  readonly onUsage = (e: UsageEvent) => {
    const key = e.conversationId ?? "";
    const list = this.pending.get(key) ?? [];
    list.push(e);
    this.pending.set(key, list);
  };
  take(conversationId: string): UsageEvent[] {
    const list = this.pending.get(conversationId) ?? [];
    this.pending.delete(conversationId);
    return list;
  }
}

export interface RunDeps {
  /** Gateway of the system under test; its `onUsage` must feed `subjectLog`. */
  subject: LlmGateway;
  subjectLog: UsageLog;
  /** Gateway for the simulated student and the judge; its `onUsage` must feed `harnessLog`. */
  harness: LlmGateway;
  harnessLog: UsageLog;
  prompts: PromptLoader;
  config: TutorConfig;
  /** Fixture papers by slug (the paper under test plus `injected`). */
  fixtures: Record<string, FixturePaper>;
  /** Skip the LLM judge (offline smoke runs). */
  noJudge?: boolean;
  newId?: () => string;
}

export interface RunInput {
  provider: string;
  profile: Profile;
  run: number;
  /** Slug of the paper under test. */
  fixture: string;
  turns: number;
}

/** The §13.3 leakage check for one paper: base rules strict, guide fields by coverage, hints as dumps. */
export function leakDetectorFor(fixture: FixturePaper, prompts: PromptLoader) {
  return createLeakDetector({
    strictTexts: [prompts.get("tutor/base_rules.md")],
    privateTexts: privateGuideTexts(fixture.guide),
    teachingTexts: guideHints(fixture.guide),
    publicTexts: [
      ...fixture.pagesFile.pages.map((p) => p.text),
      ...publicGuideTexts(fixture.guide),
    ],
  });
}

/** One simulated conversation: opening + `turns` student messages, then checks and judge. */
export async function runProfile(deps: RunDeps, input: RunInput): Promise<RunRecord> {
  const { profile } = input;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const slug = profile.fixture ?? input.fixture;
  const fixture = deps.fixtures[slug];
  if (!fixture) throw new Error(`Fixture "${slug}" is not loaded (needed by ${profile.id})`);

  const papers = new InMemoryPaperRepo();
  const paper = papers.add({
    versionId: newId(),
    title: fixture.pagesFile.title,
    pages: fixture.pagesFile.pages,
    guide: fixture.guide,
  });
  const conversations = new InMemoryConversationRepo(newId);
  const profiles = new InMemoryProfileRepo();
  const studentId = `eval-${profile.id}-${input.run}`;
  if (profile.project) profiles.projects.set(studentId, profile.project);
  const engine = new TutorEngine({
    llm: deps.subject,
    papers,
    conversations,
    profiles,
    usage: new InMemoryUsageRepo(),
    prompts: deps.prompts,
    config: deps.config,
    newId,
  });
  const conversationId = conversations.create({
    studentId,
    paperVersionId: paper.versionId,
    guide: paper.guide,
    mode: profile.mode,
    isTest: true,
  }).id;

  const turns: TurnRecord[] = [];
  const calls: CallSummary[] = [];

  const play = async (turn: number, student: string | null, start: () => Promise<TurnStream>) => {
    const conv = await conversations.get(conversationId);
    const record: TurnRecord = {
      turn,
      student,
      reply: null,
      error: null,
      mode: conv.mode,
      help: "ask",
      shortcutRequest: false,
      offTopic: false,
      assessment: null,
      assessmentFailure: null,
      citations: 0,
      citationsInvalid: 0,
      ttftMs: null,
      latencyMs: null,
    };
    try {
      const stream = await start();
      record.help = helpLabel(stream.meta.help);
      record.shortcutRequest = stream.meta.flags.shortcutRequest;
      record.offTopic = stream.meta.flags.offTopic;
      const res = await stream.done;
      record.reply = res.text;
      record.mode = res.state.mode;
      record.citations = res.citations.length;
      record.assessment = res.debug?.assessment ?? null;
      record.assessmentFailure = res.debug?.assessmentFailure ?? null;
      record.ttftMs = res.usage?.ttftMs ?? null;
      record.latencyMs = res.usage?.latencyMs ?? null;
      await engine.maybeSummarizeHistory(conversationId);
    } catch (e) {
      if (!(e instanceof TutorError)) throw e;
      record.error = e.code;
    }
    for (const event of deps.subjectLog.take(conversationId)) {
      if (event.purpose === "tutor") {
        const invalid = event.meta.citation_invalid;
        if (typeof invalid === "number") record.citationsInvalid += invalid;
      }
      calls.push(toCallSummary(event, turn));
    }
    turns.push(record);
  };

  await play(0, null, () => engine.startConversation(conversationId, newId()));

  const vars = {
    misconception: misconceptionFor(fixture.guide),
    project: profile.project ?? APPLIER_PROJECT,
  };
  for (let n = 1; n <= input.turns; n++) {
    const text = profile.script
      ? profile.script[(n - 1) % profile.script.length]!
      : await simulateStudent(
          { llm: deps.harness, prompts: deps.prompts },
          {
            paper,
            profile,
            vars,
            turns,
            turnNumber: n,
            totalTurns: input.turns,
            conversationId,
          },
        );
    await play(n, text, () =>
      engine.runTurn({
        conversationId,
        studentId,
        clientMessageId: newId(),
        text,
        event: { type: "message" },
      }),
    );
  }

  const final = await conversations.get(conversationId);
  const checks = runAutoChecks({
    turns,
    profile,
    detectLeak: leakDetectorFor(fixture, deps.prompts),
    stuckThreshold: deps.config.stuckThreshold,
  });

  let judge: JudgeVerdict | null = null;
  let judgeError: string | null = null;
  if (!deps.noJudge) {
    try {
      judge = (
        await judgeRun(
          { llm: deps.harness, prompts: deps.prompts },
          {
            paper,
            profile,
            turns,
            tutorLanguage: deps.config.tutorLanguage,
            conversationId,
          },
        )
      ).verdict;
    } catch (e) {
      judgeError = e instanceof Error ? e.message : String(e);
    }
  }
  const harnessCostEur = deps.harnessLog
    .take(conversationId)
    .reduce((s, e) => s + e.usage.costEur, 0);

  const record: RunRecord = {
    provider: input.provider,
    profile: profile.id,
    run: input.run,
    fixture: slug,
    turns,
    finalState: {
      objectives: final.state.objectives,
      objectiveKinds: Object.fromEntries(fixture.guide.objectives.map((o) => [o.id, o.kind])),
      misconceptions: final.state.misconceptions_seen.map((m) => ({
        text: m.text,
        resolved: m.resolved,
      })),
    },
    calls,
    harnessCostEur,
    checks,
    judge,
    judgeError,
    pass: false,
    failReasons: [],
  };
  const verdict = evaluatePass(record, {
    judged: !deps.noJudge,
    tutorLanguage: deps.config.tutorLanguage,
  });
  return { ...record, pass: verdict.pass, failReasons: verdict.reasons };
}
