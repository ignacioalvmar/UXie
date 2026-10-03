import type { CharacterColors, CharacterId, ResolvedColors } from "./types";

export interface CharacterMeta {
  id: CharacterId;
  name: string;
  /** What the character holds or carries; useful as a short caption in pickers. */
  prop: string;
  /** One-line description for the enrollment picker. */
  blurb: string;
  /** Colors matching the original character designs. */
  colors: CharacterColors;
  /** Curated alternatives offered in the studio. Index 0 equals `colors`. */
  swatches: { body: readonly string[]; accent: readonly string[] };
}

export const CHARACTERS: Record<CharacterId, CharacterMeta> = {
  pip: {
    id: "pip",
    name: "Pip",
    prop: "Question mark",
    blurb: "Carries a question for every idea",
    colors: { body: "#F5D98B", accent: "#B49BE8", cheek: "#F4A99A" },
    swatches: {
      body: ["#F5D98B", "#F6C39B", "#A9D6EE", "#F2B8D2"],
      accent: ["#B49BE8", "#7FC8B5", "#F28C78", "#7EA6F2"],
    },
  },
  miso: {
    id: "miso",
    name: "Miso",
    prop: "Idea satchel",
    blurb: "Ponders, then connects the dots",
    colors: { body: "#B9A7EA", accent: "#BFE3C6", cheek: "#F3A7B5" },
    swatches: {
      body: ["#B9A7EA", "#9EC8F0", "#F4B7C6", "#AEDDB9"],
      accent: ["#BFE3C6", "#F6D58B", "#F7B6A3", "#A9C8F5"],
    },
  },
  luma: {
    id: "luma",
    name: "Luma",
    prop: "Magnifier",
    blurb: "Looks closely at the evidence",
    colors: { body: "#BBDDA3", accent: "#F2866F", cheek: "#F4A58F" },
    swatches: {
      body: ["#BBDDA3", "#9FD8CE", "#F5D58C", "#CDBCF2"],
      accent: ["#F2866F", "#7EA6F2", "#B49BE8", "#F5B04F"],
    },
  },
};

/** Returns a lowercase #rrggbb string, or null when the input is not a hex color. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let h = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) {
    h =
      "#" +
      h
        .slice(1)
        .split("")
        .map((x) => x + x)
        .join("");
  }
  return /^#[0-9a-f]{6}$/.test(h) ? h : null;
}

/** Linear RGB mix of two #rrggbb colors; t = 0 returns a, t = 1 returns b. */
export function mix(a: string, b: string, t: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = parse(a);
  const y = parse(b);
  return (
    "#" +
    x
      .map((v, i) =>
        Math.round(v + ((y[i] as number) - v) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/**
 * Derives the full shading set for a character. Invalid overrides fall back to the
 * character's original colors, so stored student preferences can never break the art.
 */
export function resolveColors(
  character: CharacterId,
  overrides: Partial<CharacterColors> = {},
): ResolvedColors {
  const d = CHARACTERS[character].colors;
  const base = normalizeHex(overrides.body) ?? normalizeHex(d.body)!;
  const accent = normalizeHex(overrides.accent) ?? normalizeHex(d.accent)!;
  const cheek = normalizeHex(overrides.cheek) ?? normalizeHex(d.cheek)!;
  // Pip's body is a lighter tint of the head; Miso and Luma use the head color.
  const belly = character === "pip" ? mix(base, "#ffffff", 0.45) : base;
  const leaf = mix(base, "#2f6b2a", 0.18);
  return {
    base,
    light: mix(base, "#ffffff", 0.5),
    dark: mix(base, "#3a2a40", 0.2),
    belly,
    bellyLight: mix(belly, "#ffffff", 0.5),
    bellyDark: mix(belly, "#3a2a40", 0.14),
    accent,
    accentLight: mix(accent, "#ffffff", 0.45),
    accentMid: mix(accent, "#2a2340", 0.1),
    accentDark: mix(accent, "#2a2340", 0.28),
    accentDeep: mix(accent, "#1f2430", 0.55),
    cheek,
    leaf,
    leafLight: mix(leaf, "#ffffff", 0.35),
    leafDark: mix(leaf, "#1f2430", 0.2),
  };
}
