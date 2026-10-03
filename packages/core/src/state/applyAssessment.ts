import type { Assessment } from "../schemas/assessment";
import type { TurnEvent } from "../schemas/events";
import type { TeachingGuide } from "../schemas/guide";
import type { HelpLevel, LearnerState, ObjectiveStatus } from "../schemas/state";
import { activeObjective, computeHelpLevel, type HelpConfig } from "./helpLevel";
import { nextObjectiveId, resetState, switchMode } from "./reset";

export const MAX_MISCONCEPTIONS = 20;

const RANK: Record<ObjectiveStatus, number> = { not_started: 0, in_progress: 1, demonstrated: 2 };

export interface TurnFlags {
  shortcutRequest: boolean;
  offTopic: boolean;
}

export interface ApplyAssessmentInput {
  state: LearnerState;
  guide: TeachingGuide;
  /** null when the assessment call failed or timed out, or for events without student text. */
  assessment: Assessment | null;
  event: TurnEvent;
  config: HelpConfig;
}

export interface ApplyAssessmentResult {
  state: LearnerState;
  help: HelpLevel;
  flags: TurnFlags;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Pure state transition for one tutor turn (PRD §3.5, normative rules in §8.2).
 *
 * Bookkeeping that belongs to the help ladder itself runs on every turn, including when the
 * assessment failed: `last_help_level` records the level chosen for this reply, and a `check`
 * turn (the one after `explain`) resets `attempts` and `stuck_requests`. Otherwise a failed
 * assessment leaves the state unchanged.
 */
export function applyAssessment(input: ApplyAssessmentInput): ApplyAssessmentResult {
  const { guide, assessment, event, config } = input;
  const flags: TurnFlags = { shortcutRequest: false, offTopic: false };
  let s: LearnerState = structuredClone(input.state);

  switch (event.type) {
    case "reset":
      s = resetState(guide, s.mode);
      break;
    case "mode_switch":
      s = switchMode(s, event.mode, guide);
      break;
    case "stuck":
      s.stuck_requests += 1;
      break;
    case "start":
      break;
    case "message":
      if (assessment) applyMessageAssessment(s, guide, assessment, flags);
      break;
  }

  const help = computeHelpLevel(s, guide, config);
  if (help.kind === "check") {
    s.attempts = 0;
    s.stuck_requests = 0;
  }
  s.last_help_level = help;
  return { state: s, help, flags };
}

/** Mutates `s` (a private clone) according to one successful assessment. */
function applyMessageAssessment(
  s: LearnerState,
  guide: TeachingGuide,
  a: Assessment,
  flags: TurnFlags,
): void {
  s.language = a.language.trim().toLowerCase();

  // Objective progress: forward-only; "demonstrated" needs evidence; unknown ids ignored.
  for (const u of a.objective_updates) {
    const current = s.objectives[u.objective_id];
    if (current === undefined) continue;
    const evidence = u.evidence.trim();
    if (u.status === "demonstrated" && !evidence) continue;
    if (RANK[u.status] <= RANK[current]) continue;
    s.objectives[u.objective_id] = u.status;
    if (u.status === "demonstrated") s.evidence[u.objective_id] = evidence;
  }

  // Misconceptions: dedupe case-insensitively, attribute unknown objectives to the active one.
  if (a.misconception) {
    const objective =
      a.misconception.objective_id in s.objectives
        ? a.misconception.objective_id
        : s.active_objective;
    const text = a.misconception.text.trim();
    const seen = s.misconceptions_seen.some((m) => sameText(m.text, text));
    if (objective && text && !seen && s.misconceptions_seen.length < MAX_MISCONCEPTIONS) {
      s.misconceptions_seen.push({ objective, text, resolved: false });
    }
  }
  if (a.misconception_resolved) {
    for (const m of s.misconceptions_seen) {
      if (sameText(m.text, a.misconception_resolved)) m.resolved = true;
    }
  }

  let ladderExhausted = false;
  switch (a.intent) {
    case "answer":
      if (a.answer_quality === "correct") {
        s.attempts = 0;
        s.stuck_requests = 0;
        s.active_question_index += 1;
        const ladder = activeObjective(s, guide)?.question_ladder.length ?? 0;
        ladderExhausted = s.active_objective !== null && s.active_question_index >= ladder;
      } else {
        s.attempts += 1;
      }
      break;
    case "shortcut_request":
      flags.shortcutRequest = true;
      break;
    case "off_topic":
      flags.offTopic = true;
      break;
    case "question":
    case "meta":
    case "greeting":
      break;
  }

  const activeDemonstrated =
    s.active_objective !== null && s.objectives[s.active_objective] === "demonstrated";
  if (activeDemonstrated || ladderExhausted) advanceObjective(s, guide);
}

/**
 * Move to the next open objective for the mode. If the ladder ran out but the current objective
 * is not demonstrated and nothing else is open, stay on its last (hardest) question.
 */
function advanceObjective(s: LearnerState, guide: TeachingGuide): void {
  const current = s.active_objective;
  const next = nextObjectiveId(guide, s.objectives, s.mode, current);
  s.attempts = 0;
  s.stuck_requests = 0;
  if (next !== null) {
    s.active_objective = next;
    s.active_question_index = 0;
  } else if (current !== null && s.objectives[current] !== "demonstrated") {
    const ladder = activeObjective(s, guide)?.question_ladder.length ?? 1;
    s.active_question_index = ladder - 1;
  } else {
    s.active_objective = null;
    s.active_question_index = 0;
  }
}
