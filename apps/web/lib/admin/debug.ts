import type { LearnerState } from "@uxie/core";
import type { TurnResult } from "@uxie/tutor";

/**
 * The "Test as student" debug panel (FR-6.5): assessment JSON, help level, state diff, prompt
 * version, tokens, cached tokens, latency. Built on the server from the engine's TurnResult and
 * sent only on the instructor test-chat route.
 */

export interface StateChange {
  /** Dotted path, e.g. `objectives.U1` or `attempts`. */
  path: string;
  before: unknown;
  after: unknown;
}

export interface TurnDebugDto {
  help: string;
  assessment: unknown;
  assessmentFailure: string | null;
  stateChanges: StateChange[];
  promptVersion: string;
  contextStrategy: string;
  pagesIncluded: number[] | "all";
  provider: string | null;
  model: string | null;
  tokens: { input: number; output: number; cachedInput: number; cacheWrite: number } | null;
  assessmentTokens: { input: number; output: number; model: string } | null;
  latencyMs: number | null;
  ttftMs: number | null;
  costEur: number | null;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function flatten(value: unknown, prefix: string, out: Map<string, unknown>) {
  if (isPlain(value) && Object.keys(value).length) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
}

/** Leaf-level differences between two learner states (objects flattened; arrays compared whole). */
export function stateDiff(before: LearnerState, after: LearnerState): StateChange[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten(before, "", a);
  flatten(after, "", b);
  const paths = [...new Set([...a.keys(), ...b.keys()])];
  return paths
    .filter((p) => JSON.stringify(a.get(p)) !== JSON.stringify(b.get(p)))
    .map((p) => ({ path: p, before: a.get(p) ?? null, after: b.get(p) ?? null }));
}

export function turnDebugDto(result: TurnResult): TurnDebugDto | null {
  const d = result.debug;
  if (!d) return null;
  const help = result.help.kind === "hint" ? `hint:${result.help.index}` : result.help.kind;
  const u = result.usage;
  return {
    help,
    assessment: d.assessment,
    assessmentFailure: d.assessmentFailure,
    stateChanges: stateDiff(d.previousState, result.state),
    promptVersion: d.promptVersion,
    contextStrategy: d.contextStrategy,
    pagesIncluded: d.pagesIncluded,
    provider: u?.provider ?? null,
    model: u?.model ?? null,
    tokens: u
      ? {
          input: u.inputTokens,
          output: u.outputTokens,
          cachedInput: u.cachedInputTokens,
          cacheWrite: u.cacheWriteInputTokens,
        }
      : null,
    assessmentTokens: d.assessmentUsage
      ? {
          input: d.assessmentUsage.inputTokens,
          output: d.assessmentUsage.outputTokens,
          model: d.assessmentUsage.model,
        }
      : null,
    latencyMs: u?.latencyMs ?? null,
    ttftMs: u?.ttftMs ?? null,
    costEur: u ? u.costEur + (d.assessmentUsage?.costEur ?? 0) : null,
  };
}
