import { writeFileSync } from "node:fs";
import { BaseEnvSchema, llmSettingsFromEnv, llmSettingsProblems, parseEnv } from "@uxie/core";
import {
  evalMockResponder,
  parseDuration,
  parseProviderSpec,
  renderLoadTest,
  runLoadTest,
  settingsForSpec,
  specFromSettings,
  withMockDelay,
  type LoadTestResult,
} from "@uxie/eval";
import { createGateway } from "@uxie/llm";
import { loadPromptDir, tutorConfig } from "@uxie/tutor";
import { promptsDir } from "../paths";
import { loadFixture, resultPaths } from "./eval";

export interface LoadTestCliOptions {
  concurrency: string;
  duration: string;
  fixture: string;
  provider?: string;
  think: string;
  mockDelay: string;
  out?: string;
}

/** `pnpm uxie loadtest --concurrency 5,10,15`: TTFT p95 and error rate under load (PRD §13.4). */
export async function loadtestCommand(opts: LoadTestCliOptions): Promise<void> {
  const env = parseEnv(BaseEnvSchema, process.env);
  const base = llmSettingsFromEnv(env);
  const spec = opts.provider ? parseProviderSpec(opts.provider) : specFromSettings(base);
  const settings = settingsForSpec(base, spec);
  const problems = llmSettingsProblems(settings);
  if (problems.length)
    throw new Error(`Cannot load-test ${spec.label}:\n  - ${problems.join("\n  - ")}`);

  const levels = opts.concurrency.split(/[\s,]+/).map((s) => {
    const n = Number(s.trim());
    if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid concurrency "${s}"`);
    return n;
  });
  const durationMs = parseDuration(opts.duration);
  const thinkMs = parseDuration(opts.think);
  const { slug, fixture } = loadFixture(opts.fixture);
  const prompts = loadPromptDir(promptsDir);
  const mockDelay = parseDuration(opts.mockDelay);

  const results: LoadTestResult[] = [];
  for (const concurrency of levels) {
    console.log(`${spec.label}: ${concurrency} concurrent students for ${opts.duration}…`);
    // A fresh gateway per level, so cache state from one level does not flatter the next.
    const gateway = createGateway(settings, {
      mockResponder: mockDelay ? withMockDelay(evalMockResponder, mockDelay) : evalMockResponder,
    });
    const r = await runLoadTest({
      gateway,
      prompts,
      config: tutorConfig(env, settings),
      fixture,
      concurrency,
      durationMs,
      thinkMs,
    });
    results.push(r);
    const s = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);
    console.log(
      `  ${r.turns} turns · TTFT p50 ${s(r.ttftP50)} p95 ${s(r.ttftP95)} · errors ${r.errors} (${r.errorRate === null ? "–" : `${(r.errorRate * 100).toFixed(1)}%`}) · €${r.costEur.toFixed(3)}`,
    );
  }

  const createdAt = new Date().toISOString();
  const paths = resultPaths(opts.out, `loadtest-${slug}`);
  writeFileSync(
    paths.md,
    renderLoadTest(results, { provider: spec.label, fixture: slug, createdAt }),
  );
  writeFileSync(
    paths.json,
    `${JSON.stringify({ createdAt, provider: spec.label, fixture: slug, results }, null, 2)}\n`,
  );
  console.log(`\nReport: ${paths.md}`);
}
