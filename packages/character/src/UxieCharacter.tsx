"use client";

import { useId, type CSSProperties } from "react";
import { Luma } from "./art/Luma";
import { Miso } from "./art/Miso";
import { Pip } from "./art/Pip";
import { CHARACTERS, resolveColors } from "./palette";
import { STATE_META } from "./states";
import {
  isCharacterId,
  isCharacterState,
  type CharacterColors,
  type CharacterId,
  type CharacterState,
  type Tempo,
} from "./types";

const ART = { pip: Pip, miso: Miso, luma: Luma } as const;

/** Art is drawn on a 300x340 viewBox; height follows width at this ratio. */
export const CHARACTER_ASPECT = 340 / 300;

export interface UxieCharacterProps {
  /** Which embodiment the student chose at enrollment. */
  character: CharacterId;
  /** Animation state; see STATE_META and stateForTurn(). */
  state?: CharacterState;
  /** Width in px. Height is width × 340/300. */
  size?: number;
  tempo?: Tempo;
  /** Freezes motion in place (e.g. a "reduce motion" toggle in account settings). */
  paused?: boolean;
  /** Student color customization. Invalid values fall back to the original palette. */
  colors?: Partial<CharacterColors>;
  /** Accessible name. Defaults to "UXie as Pip, thinking". */
  label?: string;
  /** Hide from assistive tech when the surrounding UI already names UXie. */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function UxieCharacter({
  character,
  state = "idle",
  size = 120,
  tempo = "normal",
  paused = false,
  colors,
  label,
  decorative = false,
  className,
  style,
}: UxieCharacterProps) {
  const u = "ux" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id: CharacterId = isCharacterId(character) ? character : "pip";
  const st: CharacterState = isCharacterState(state) ? state : "idle";
  const Art = ART[id];
  const c = resolveColors(id, colors);

  const classes = ["uxie", `s-${st}`, `t-${tempo}`, paused ? "ux-still" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  const a11y = decorative
    ? { "aria-hidden": true as const }
    : {
        role: "img" as const,
        "aria-label":
          label ?? `UXie as ${CHARACTERS[id].name}, ${STATE_META[st].label.toLowerCase()}`,
      };

  return (
    <div
      className={classes}
      data-character={id}
      data-state={st}
      style={{ width: size, height: Math.round(size * CHARACTER_ASPECT), ...style }}
      {...a11y}
    >
      <Art c={c} u={u} />
    </div>
  );
}
