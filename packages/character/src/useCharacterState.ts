"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterState } from "./types";

export const DEFAULT_FLASH_MS = 1800;

/**
 * Holds a resting state (usually from stateForTurn) and lets the app flash a
 * transient state on top of it, e.g. celebrate when an objective is demonstrated.
 *
 *   const [state, flash] = useCharacterState(stateForTurn(turn));
 *   useEffect(() => { if (justDemonstrated) flash("celebrate"); }, [justDemonstrated]);
 */
export function useCharacterState(
  resting: CharacterState,
): [CharacterState, (state: CharacterState, ms?: number) => void] {
  const [flashState, setFlashState] = useState<CharacterState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((state: CharacterState, ms: number = DEFAULT_FLASH_MS) => {
    if (timer.current) clearTimeout(timer.current);
    setFlashState(state);
    timer.current = setTimeout(() => setFlashState(null), ms);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return [flashState ?? resting, flash];
}
