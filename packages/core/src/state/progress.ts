import type { ObjectiveKind, TeachingGuide } from "../schemas/guide";
import type { LearnerState, ObjectiveStatus } from "../schemas/state";

/** What the student's Progress drawer may show (FR-3.5): statements and status, no guide internals. */
export interface ProgressItem {
  id: string;
  kind: ObjectiveKind;
  statement: string;
  status: ObjectiveStatus;
  evidence: string | null;
  active: boolean;
}

export function progressView(state: LearnerState, guide: TeachingGuide): ProgressItem[] {
  return guide.objectives.map((o) => ({
    id: o.id,
    kind: o.kind,
    statement: o.statement,
    status: state.objectives[o.id] ?? "not_started",
    evidence: state.evidence[o.id] ?? null,
    active: state.active_objective === o.id,
  }));
}

/** North-star proxy (PRD §1.5): ≥1 understanding AND ≥1 application objective demonstrated. */
export function meetsNorthStar(state: LearnerState, guide: TeachingGuide): boolean {
  const demonstrated = (kind: ObjectiveKind) =>
    guide.objectives.some((o) => o.kind === kind && state.objectives[o.id] === "demonstrated");
  return demonstrated("understanding") && demonstrated("application");
}
