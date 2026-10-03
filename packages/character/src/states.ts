import type { CharacterState } from "./types";

export interface StateMeta {
  label: string;
  /** The tutor event that should show this state (PRD §3.2–3.4). */
  trigger: string;
  /** Transient states play once and should return to a resting state. */
  transient: boolean;
}

export const STATE_META: Record<CharacterState, StateMeta> = {
  idle: { label: "Idle", trigger: "Waiting for the student", transient: false },
  listening: { label: "Listening", trigger: "Student is typing", transient: false },
  thinking: {
    label: "Thinking",
    trigger: "Assessment runs, before the first token",
    transient: false,
  },
  talking: {
    label: "Talking",
    trigger: "Reply streams (help level ask or check)",
    transient: false,
  },
  hint: { label: "Hint", trigger: "Reply streams with help level hint", transient: false },
  explain: { label: "Explain", trigger: "Reply streams with help level explain", transient: false },
  celebrate: { label: "Celebrate", trigger: "An objective reaches demonstrated", transient: true },
  puzzled: { label: "Puzzled", trigger: "Off-topic or shortcut request", transient: false },
};

/** Where the current chat turn is. Map from the chat UI's own status. */
export type TurnPhase = "idle" | "typing" | "assessing" | "streaming";

/** Mirrors HelpLevel["kind"] in packages/core (kept structural so this package has no deps). */
export type HelpKind = "ask" | "hint" | "explain" | "check";

export interface TurnSignal {
  phase: TurnPhase;
  /** Help level computed for the reply being streamed. */
  help?: HelpKind;
  /** Flags returned by applyAssessment for this turn. */
  flags?: { shortcutRequest?: boolean; offTopic?: boolean };
}

/**
 * Pure mapping from the tutor turn to a resting character state.
 * Celebrate is not derived here: trigger it with useCharacterState().flash("celebrate")
 * when an objective transitions to `demonstrated`.
 */
export function stateForTurn(signal: TurnSignal): CharacterState {
  switch (signal.phase) {
    case "typing":
      return "listening";
    case "assessing":
      return "thinking";
    case "streaming":
      if (signal.flags?.offTopic || signal.flags?.shortcutRequest) return "puzzled";
      if (signal.help === "hint") return "hint";
      if (signal.help === "explain") return "explain";
      return "talking";
    case "idle":
    default:
      return "idle";
  }
}
