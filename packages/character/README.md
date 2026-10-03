# @uxie/character

Animated 2D embodiments of UXie (Pip, Miso, Luma) as React components. The art is inline SVG
and the motion is plain CSS, so there is no animation library and nothing runs per frame in
JavaScript. Ported from the "UXie characters" design canvas.

## Contents

```
src/
  UxieCharacter.tsx     the component ("use client")
  art/{Pip,Miso,Luma}.tsx  SVG art on a 300x340 viewBox, one file per embodiment
  uxie-motion.css       all states, tempos and keyframes
  states.ts             STATE_META + stateForTurn(): tutor turn -> character state
  useCharacterState.ts  hook for transient states (celebrate) on top of a resting state
  palette.ts            original colors, curated swatches, color derivation
  types.ts              CharacterId, CharacterState, Tempo, guards
```

## Install in the monorepo

The package ships TypeScript source (like the other `packages/*`).

1. `pnpm-workspace.yaml` already covers `packages/*`; add `"@uxie/character": "workspace:*"` to
   `apps/web/package.json`.
2. In `apps/web/next.config.ts`: `transpilePackages: ["@uxie/character"]`.
3. Import the stylesheet once, in `apps/web/app/layout.tsx`:
   `import "@uxie/character/styles.css";`

## Usage

```tsx
import { UxieCharacter, stateForTurn, useCharacterState } from "@uxie/character";

const [state, flash] = useCharacterState(stateForTurn({ phase, help: helpLevel?.kind, flags }));
// when an objective transitions to "demonstrated":
flash("celebrate");

<UxieCharacter
  character={profile.uxie_character} // "pip" | "miso" | "luma", chosen at enrollment
  colors={profile.uxie_colors} // optional { body, accent, cheek }
  state={state}
  size={120}
/>;
```

| Prop         | Default                 | Notes                                                          |
| ------------ | ----------------------- | -------------------------------------------------------------- |
| `character`  | required                | `"pip"`, `"miso"` or `"luma"`; unknown values fall back to Pip |
| `state`      | `"idle"`                | one of the eight states below                                  |
| `size`       | `120`                   | width in px; height is width × 340/300                         |
| `tempo`      | `"normal"`              | `"slow"`, `"normal"`, `"fast"`                                 |
| `paused`     | `false`                 | freezes motion in place                                        |
| `colors`     | original                | `Partial<{ body, accent, cheek }>`; invalid hex falls back     |
| `label`      | "UXie as Pip, thinking" | accessible name (`role="img"`)                                 |
| `decorative` | `false`                 | `aria-hidden` when nearby UI already names UXie                |

## States

| State     | Shown when                              | `stateForTurn` input                        |
| --------- | --------------------------------------- | ------------------------------------------- |
| idle      | Waiting for the student                 | `phase: "idle"`                             |
| listening | Student is typing                       | `phase: "typing"`                           |
| thinking  | Assessment runs, before the first token | `phase: "assessing"`                        |
| talking   | Reply streams (help ask or check)       | `phase: "streaming"`                        |
| hint      | Reply streams with help level hint      | `help: "hint"`                              |
| explain   | Reply streams with help level explain   | `help: "explain"`                           |
| puzzled   | Off-topic or shortcut request           | `flags.offTopic` or `flags.shortcutRequest` |
| celebrate | Objective reaches demonstrated          | transient: `flash("celebrate")`             |

Off-topic and shortcut flags take priority over the help level. `HelpKind` mirrors
`HelpLevel["kind"]` in `packages/core` structurally, so this package has no dependency on it.

## Persisting the student's choice

Store the embodiment on the student's profile at enrollment, e.g. `profiles.uxie_character text
check (uxie_character in ('pip','miso','luma'))` and optionally `profiles.uxie_colors jsonb`.
Validate with `isCharacterId()` / `normalizeHex()` or a zod enum over `CHARACTER_IDS`.
`CHARACTERS[id]` provides the name, prop, blurb and swatches for the picker.

## Accessibility and motion

- Root is `role="img"` with a state-aware label, or `aria-hidden` when `decorative`.
- `prefers-reduced-motion: reduce` collapses every animation to a single, near-instant run.
- `paused` maps to `animation-play-state: paused` for an in-app "reduce motion" setting.
- The state is visual only: keep announcing tutor status in text (e.g. the chat's live region).

## Editing the art

Each part has a class the CSS animates: `ux-root` (whole body), `ux-head`, `ux-tuft`
(curl, ears, leaves), `ux-eye` (blink), `ux-look` (pupils), `ux-brows`, `ux-armP` (the arm
holding the prop), `ux-armO`, mouths `ux-m-idle|open|talk|o`, and effects
`ux-fx-think|bulb|spark|q`. Pivot points are inline `transformOrigin` values in viewBox units;
`dirL` / `dirR` flip rotation direction for left and right limbs. Gradient and clip ids get a
per-instance suffix from `useId()`, so any number of characters can share a page.

## Scripts

```
pnpm --filter @uxie/character typecheck
pnpm --filter @uxie/character test
```
