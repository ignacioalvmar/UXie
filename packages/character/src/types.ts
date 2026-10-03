export const CHARACTER_IDS = ["pip", "miso", "luma"] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export const CHARACTER_STATES = [
  "idle",
  "listening",
  "thinking",
  "talking",
  "hint",
  "explain",
  "celebrate",
  "puzzled",
] as const;
export type CharacterState = (typeof CHARACTER_STATES)[number];

export const TEMPOS = ["slow", "normal", "fast"] as const;
export type Tempo = (typeof TEMPOS)[number];

/** The three colors a student (or the app) can customize. Hex strings, #rgb or #rrggbb. */
export interface CharacterColors {
  body: string;
  accent: string;
  cheek: string;
}

/** Full shading set derived from CharacterColors. Consumed by the SVG art. */
export interface ResolvedColors {
  base: string;
  light: string;
  dark: string;
  belly: string;
  bellyLight: string;
  bellyDark: string;
  accent: string;
  accentLight: string;
  accentMid: string;
  accentDark: string;
  accentDeep: string;
  cheek: string;
  leaf: string;
  leafLight: string;
  leafDark: string;
}

/** Props every art component receives: resolved colors and an id suffix unique per instance. */
export interface ArtProps {
  c: ResolvedColors;
  u: string;
}

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === "string" && (CHARACTER_IDS as readonly string[]).includes(value);
}

export function isCharacterState(value: unknown): value is CharacterState {
  return typeof value === "string" && (CHARACTER_STATES as readonly string[]).includes(value);
}
