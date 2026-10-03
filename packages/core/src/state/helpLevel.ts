import type { Objective, TeachingGuide } from "../schemas/guide";
import type { HelpLevel, LearnerState } from "../schemas/state";

export interface HelpConfig {
  stuckThreshold: number;
}

export function activeObjective(state: LearnerState, guide: TeachingGuide): Objective | null {
  if (state.active_objective === null) return null;
  return guide.objectives.find((o) => o.id === state.active_objective) ?? null;
}

/**
 * Deterministic help ladder (PRD §3.3, §8.2). With n = attempts + stuck_requests:
 * after `explain` → `check`; n = 0 → `ask`; n ≥ threshold → `explain`; else `hint(min(n-1, last))`.
 *
 * Without an active objective (Build mode, or everything demonstrated) there are no hints to give,
 * so the ladder skips straight from `ask` to `explain` at the threshold.
 */
export function computeHelpLevel(
  state: LearnerState,
  guide: TeachingGuide,
  cfg: HelpConfig,
): HelpLevel {
  if (state.last_help_level.kind === "explain") return { kind: "check" };
  const n = state.attempts + state.stuck_requests;
  if (n === 0) return { kind: "ask" };
  if (n >= cfg.stuckThreshold) return { kind: "explain" };
  const hints = activeObjective(state, guide)?.hints.length ?? 0;
  if (hints === 0) return { kind: "ask" };
  return { kind: "hint", index: Math.min(n - 1, hints - 1) };
}
