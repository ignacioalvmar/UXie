import type { ObjectiveKind, TeachingGuide } from "../schemas/guide";
import type { LearnerState, Mode } from "../schemas/state";

/** Which objective kind each focus mode drives (PRD §3.2). Build mode is exploratory. */
export const MODE_OBJECTIVE_KIND: Record<Mode, ObjectiveKind | null> = {
  understand: "understanding",
  apply: "application",
  critique: "critique",
  build: null,
};

/**
 * Next objective for `mode` that is not demonstrated, in guide order, starting after `afterId`
 * and wrapping around. `afterId` itself is never returned. null if there is none.
 */
export function nextObjectiveId(
  guide: TeachingGuide,
  objectives: LearnerState["objectives"],
  mode: Mode,
  afterId: string | null = null,
): string | null {
  const kind = MODE_OBJECTIVE_KIND[mode];
  if (!kind) return null;
  const list = guide.objectives;
  const start = afterId === null ? 0 : list.findIndex((o) => o.id === afterId) + 1;
  for (let k = 0; k < list.length; k++) {
    const o = list[(start + k) % list.length]!;
    if (o.id !== afterId && o.kind === kind && objectives[o.id] !== "demonstrated") return o.id;
  }
  return null;
}

/** Fresh state for a new conversation (PRD §3.4). */
export function initialState(guide: TeachingGuide, mode: Mode = "understand"): LearnerState {
  const objectives = Object.fromEntries(
    guide.objectives.map((o) => [o.id, "not_started" as const]),
  );
  return {
    schema_version: 1,
    mode,
    active_objective: nextObjectiveId(guide, objectives, mode),
    active_question_index: 0,
    attempts: 0,
    stuck_requests: 0,
    last_help_level: { kind: "ask" },
    objectives,
    evidence: {},
    misconceptions_seen: [],
    history_summary: "",
    summarized_through_message_id: null,
    language: "en",
  };
}

/** "Start over" (FR-3.5): the new conversation starts from scratch in the chosen mode. */
export function resetState(guide: TeachingGuide, mode: Mode): LearnerState {
  return initialState(guide, mode);
}

/**
 * Switch focus mode (FR-4.7). Progress, evidence, misconceptions, summary and language are kept;
 * the help ladder restarts on the first open objective of the new mode's kind.
 */
export function switchMode(state: LearnerState, mode: Mode, guide: TeachingGuide): LearnerState {
  if (state.mode === mode) return state;
  return {
    ...state,
    mode,
    active_objective: nextObjectiveId(guide, state.objectives, mode),
    active_question_index: 0,
    attempts: 0,
    stuck_requests: 0,
    last_help_level: { kind: "ask" },
  };
}
