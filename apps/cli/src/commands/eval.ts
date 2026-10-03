import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { styleText } from "node:util";
import { parse as parseYaml } from "yaml";
import {
  BaseEnvSchema,
  llmSettingsFromEnv,
  llmSettingsProblems,
  parseEnv,
  type LlmSettings,
} from "@uxie/core";
import {
  evalMockResponder,
  harnessSettings,
  parseProfiles,
  parseProviderSpecs,
  PROFILES,
  renderScorecard,
  rescoreReport,
  runEval,
  settingsForSpec,
  specFromSettings,
  UsageLog,
  type EvalCandidate,
  type EvalReport,
  type ProviderSpec,
} from "@uxie/eval";
import { createGateway } from "@uxie/llm";
import { loadPromptDir, tutorConfig } from "@uxie/tutor";
import { loadFixturePaper, type FixturePaper } from "@uxie/tutor/testing";
import { promptsDir, repoRoot, resolveFixtureDir, userPath } from "../paths";

export interface EvalCliOptions {
  profiles?: string;
  runs: string;
  turns: string;
  providers?: string;
  parallel: string;
  out?: string;
  judge: boolean;
  rescore?: string;
}

const dim = (s: string) => styleText("dim", s);
const green = (s: string) => styleText("green", s);
const red = (s: string) => styleText("red", s);

const positiveInt = (name: string, v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
};

function checkSettings(what: string, s: LlmSettings) {
  const problems = llmSettingsProblems(s);
  if (problems.length) throw new Error(`${what}:\n  - ${problems.join("\n  - ")}`);
}

export function loadFixture(target: string): { slug: string; fixture: FixturePaper } {
  const dir = resolveFixtureDir(target);
  if (!dir) throw new Error(`No fixture "${target}" (looked for pages.json)`);
  const fixture = loadFixturePaper(dir, { parseYaml });
  return { slug: fixture.slug, fixture };
}

/** `eval-results/<date>/<name>.md|json`, without overwriting earlier runs of the day. */
export function resultPaths(outDir: string | undefined, name: string, date = new Date()) {
  const dir = outDir
    ? userPath(outDir)
    : resolve(repoRoot, "eval-results", date.toISOString().slice(0, 10));
  mkdirSync(dir, { recursive: true });
  let base = name;
  for (let i = 2; existsSync(join(dir, `${base}.md`)); i++) base = `${name}-${i}`;
  return { md: join(dir, `${base}.md`), json: join(dir, `${base}.json`) };
}

/** `pnpm uxie eval <fixture>`: simulated students → scorecard (PRD §13, §16 M4). */
export async function evalCommand(target: string, opts: EvalCliOptions): Promise<void> {
  if (opts.rescore) return rescoreCommand(target, opts.rescore);
  const env = parseEnv(BaseEnvSchema, process.env);
  const base = llmSettingsFromEnv(env);
  const specs: ProviderSpec[] = parseProviderSpecs(opts.providers);
  if (!specs.length) specs.push(specFromSettings(base));
  const profiles = parseProfiles(opts.profiles);
  const runs = positiveInt("runs", opts.runs);
  const turns = positiveInt("turns", opts.turns);
  const parallel = positiveInt("parallel", opts.parallel);

  const main = loadFixture(target);
  const fixtures: Record<string, FixturePaper> = { [main.slug]: main.fixture };
  for (const p of profiles) {
    if (p.fixture && !fixtures[p.fixture]) fixtures[p.fixture] = loadFixture(p.fixture).fixture;
  }

  const prompts = loadPromptDir(promptsDir);
  const candidates: EvalCandidate[] = specs.map((spec) => {
    const settings = settingsForSpec(base, spec);
    checkSettings(`Cannot evaluate ${spec.label}`, settings);
    const log = new UsageLog();
    return {
      info: {
        label: spec.label,
        tutor: `${settings.roles.tutor.provider}:${settings.roles.tutor.model}`,
        state: `${settings.roles.state.provider}:${settings.roles.state.model}`,
        effort: settings.effort,
      },
      gateway: createGateway(settings, { onUsage: log.onUsage, mockResponder: evalMockResponder }),
      log,
      config: tutorConfig(env, settings),
    };
  });
  const hSettings = harnessSettings(base);
  checkSettings(
    "Cannot run the simulated students / judge (LLM_JUDGE_PROVIDER, LLM_JUDGE_MODEL)",
    hSettings,
  );
  const harnessLog = new UsageLog();
  const judge = hSettings.roles.judge;

  const total = specs.length * profiles.length * runs;
  console.log(
    `Eval ${main.slug}: ${specs.map((s) => s.label).join(", ")} × ${profiles.length} profiles × ${runs} run(s) × ${turns} turns = ${total} conversations`,
  );
  console.log(
    dim(
      `students + judge: ${judge.provider}:${judge.model}${opts.judge ? "" : " (judge off)"} · ${parallel} in parallel`,
    ),
  );

  const report = await runEval({
    fixture: main.slug,
    fixtures,
    candidates,
    harness: {
      gateway: createGateway(hSettings, {
        onUsage: harnessLog.onUsage,
        mockResponder: evalMockResponder,
      }),
      log: harnessLog,
      label: `${judge.provider}:${judge.model}`,
    },
    prompts,
    config: { stuckThreshold: env.STUCK_THRESHOLD, tutorLanguage: env.TUTOR_LANGUAGE },
    profiles,
    runs,
    turns,
    parallel,
    noJudge: !opts.judge,
    monthlyCeilingEur: env.MONTHLY_SPEND_CEILING_EUR,
    onProgress: (r, done, all) => {
      const cost = r.calls.reduce((s, c) => s + c.costEur, 0) + r.harnessCostEur;
      console.log(
        `[${done}/${all}] ${r.provider} · ${PROFILES[r.profile].label} #${r.run} ${r.pass ? green("pass") : red("fail")}${r.failReasons.length ? dim(` (${r.failReasons.join("; ")})`) : ""} ${dim(`€${cost.toFixed(3)}`)}`,
      );
    },
  });

  const paths = resultPaths(opts.out, main.slug);
  writeFileSync(paths.md, renderScorecard(report));
  writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);

  console.log("");
  for (const p of report.providers) {
    console.log(`${p.label}: ${p.passedRuns}/${p.runs} runs passed`);
    for (const t of p.thresholds) {
      const mark = t.status === "pass" ? green("✓") : t.status === "fail" ? red("✗") : dim("–");
      console.log(`  ${mark} ${t.label}: ${t.display} ${dim(`(${t.target}; ${t.basis})`)}`);
    }
  }
  console.log(`\nScorecard: ${paths.md}\nDetails:   ${paths.json}`);
}

/** `--rescore <report.json>`: recompute checks, pass/fail and thresholds with no model calls. */
function rescoreCommand(target: string, file: string) {
  const path = userPath(file);
  const report = JSON.parse(readFileSync(path, "utf8")) as EvalReport;
  const main = loadFixture(target);
  const fixtures: Record<string, FixturePaper> = { [main.slug]: main.fixture };
  for (const slug of new Set(report.runs.map((r) => r.fixture))) {
    if (!fixtures[slug]) fixtures[slug] = loadFixture(slug).fixture;
  }
  const next = rescoreReport(report, { fixtures, prompts: loadPromptDir(promptsDir) });
  const base = path.replace(/\.json$/, "");
  writeFileSync(`${base}.rescored.md`, renderScorecard(next));
  writeFileSync(`${base}.rescored.json`, `${JSON.stringify(next, null, 2)}\n`);
  for (const p of next.providers) {
    console.log(`${p.label}: ${p.passedRuns}/${p.runs} runs passed`);
    for (const t of p.thresholds) {
      const mark = t.status === "pass" ? green("✓") : t.status === "fail" ? red("✗") : dim("–");
      console.log(`  ${mark} ${t.label}: ${t.display} ${dim(`(${t.basis})`)}`);
    }
  }
  console.log(`\nScorecard: ${base}.rescored.md`);
}
