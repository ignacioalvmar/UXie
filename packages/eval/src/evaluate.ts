import type { LlmGateway } from "@uxie/llm";
import type { PromptLoader, TutorConfig } from "@uxie/tutor";
import type { FixturePaper } from "@uxie/tutor/testing";
import type { Profile } from "./profiles";
import { runProfile, type UsageLog } from "./runner";
import { scoreProvider, type EvalReport, type ProviderInfo } from "./scorecard";
import { mapLimit } from "./stats";
import type { RunRecord } from "./types";

export interface EvalCandidate {
  info: ProviderInfo;
  /** Gateway whose `onUsage` feeds `log`. */
  gateway: LlmGateway;
  log: UsageLog;
  /** Tutor config for this candidate (context window and output budget follow its model). */
  config: TutorConfig;
}

export interface EvalOptions {
  fixture: string;
  fixtures: Record<string, FixturePaper>;
  candidates: EvalCandidate[];
  harness: { gateway: LlmGateway; log: UsageLog; label: string };
  prompts: PromptLoader;
  /** Shared tutor behaviour reported in the scorecard (STUCK_THRESHOLD, TUTOR_LANGUAGE). */
  config: Pick<TutorConfig, "stuckThreshold" | "tutorLanguage">;
  profiles: Profile[];
  runs: number;
  turns: number;
  /** Simulated conversations in flight at once. */
  parallel: number;
  noJudge?: boolean;
  monthlyCeilingEur: number;
  onProgress?: (run: RunRecord, done: number, total: number) => void;
  now?: () => Date;
  newId?: () => string;
}

function crashedRun(
  provider: string,
  profile: Profile,
  run: number,
  fixture: string,
  error: unknown,
): RunRecord {
  return {
    provider,
    profile: profile.id,
    run,
    fixture: profile.fixture ?? fixture,
    turns: [],
    finalState: { objectives: {}, objectiveKinds: {}, misconceptions: [] },
    calls: [],
    harnessCostEur: 0,
    checks: {
      longReplies: [],
      manyQuestions: [],
      citationsInvalid: 0,
      understandCitationRate: null,
      leakedPhrases: [],
      helpSequence: null,
      germanReplyRate: null,
    },
    judge: null,
    judgeError: null,
    pass: false,
    failReasons: [`run crashed: ${error instanceof Error ? error.message : String(error)}`],
  };
}

/** Every candidate × profile × run (PRD §13.1, §13.4), then one scorecard per candidate. */
export async function runEval(o: EvalOptions): Promise<EvalReport> {
  const tasks = o.candidates.flatMap((candidate) =>
    o.profiles.flatMap((profile) =>
      Array.from({ length: o.runs }, (_, i) => ({ candidate, profile, run: i + 1 })),
    ),
  );
  let done = 0;
  const runs = await mapLimit(tasks, o.parallel, async ({ candidate, profile, run }) => {
    let record: RunRecord;
    try {
      record = await runProfile(
        {
          subject: candidate.gateway,
          subjectLog: candidate.log,
          harness: o.harness.gateway,
          harnessLog: o.harness.log,
          prompts: o.prompts,
          config: candidate.config,
          fixtures: o.fixtures,
          noJudge: o.noJudge,
          newId: o.newId,
        },
        { provider: candidate.info.label, profile, run, fixture: o.fixture, turns: o.turns },
      );
    } catch (e) {
      record = crashedRun(candidate.info.label, profile, run, o.fixture, e);
    }
    o.onProgress?.(record, ++done, tasks.length);
    return record;
  });

  return {
    createdAt: (o.now?.() ?? new Date()).toISOString(),
    fixture: o.fixture,
    turns: o.turns,
    runsPerProfile: o.runs,
    stuckThreshold: o.config.stuckThreshold,
    tutorLanguage: o.config.tutorLanguage,
    judge: o.noJudge ? null : o.harness.label,
    monthlyCeilingEur: o.monthlyCeilingEur,
    providers: o.candidates.map((c) =>
      scoreProvider(
        c.info,
        runs.filter((r) => r.provider === c.info.label),
        { monthlyCeilingEur: o.monthlyCeilingEur },
      ),
    ),
    runs,
  };
}
