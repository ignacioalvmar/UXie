# Handoff spec: UXie auth screens (sign in, sign up, verify, reset)

Status: design approved (direction A, "Trio welcome", with the conversational voice of direction B).
Source of truth: the "UXie Login" design canvas, page **Final**. This folder is the coding-agent copy.
Implements PRD §2.3 row "Sign up / sign in / verify / reset" (`/auth/*`) and FR-1.1, FR-1.2.

## 0. What is in this folder

| Path                         | What it is                                               | How to use it                                                                                       |
| ---------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `HANDOFF.md`                 | This spec                                                | Read first. Wins over the reference HTML if they disagree.                                          |
| `tokens.css`                 | Tailwind v4 `@theme` tokens + bubble and focus utilities | Merge into `apps/web/app/globals.css`                                                               |
| `reference/*.html`           | Static exports of each screen (inline styles)            | Open in a browser for visual comparison. Do NOT copy the markup; rebuild with Tailwind + shadcn/ui. |
| `assets/{pip,miso,luma}.png` | Transparent character cut-outs                           | Visual reference only. In the app, render characters with `@uxie/character`.                        |

Reference file to screen mapping:

| Reference                    | Route                       | Notes                                                                |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `sign-in-web.html`           | `/auth/sign-in` (≥ 1024 px) | Two-column split                                                     |
| `sign-in-mobile.html`        | `/auth/sign-in` (< 1024 px) | Same route, stacked layout                                           |
| `sign-in-error-mobile.html`  | `/auth/sign-in` error state | Domain error shown; credential error described below                 |
| `sign-up-mobile.html`        | `/auth/sign-up`             |                                                                      |
| `verify-email-mobile.html`   | `/auth/verify`              | After sign-up, and when an unverified user signs in                  |
| `reset-password-mobile.html` | `/auth/reset`               | Request link. "Set new password" screen is not designed yet (see §9) |

## 1. Overview

Students reach these screens before anything else in UXie. The goal is a calm, low-friction entry that already sounds like UXie: a curious study buddy who asks questions. The three characters (Pip, Miso, Luma) appear together because the student has not picked one yet; they choose at enrollment, after email verification.

Voice rules (from PRD §2.6, applied to auth): welcoming, curious, concise. Character lines are short questions or reassurances in a speech bubble. Functional copy (labels, buttons, errors) stays plain and literal; the bubble carries the personality, never the instructions.

## 2. Stack notes

- Next.js 16 App Router, React 19, Tailwind CSS v4, shadcn/ui (Radix) per the PRD stack table. Supabase Auth via `@supabase/ssr` (email + password).
- Put the screens under `apps/web/app/(auth)/auth/{sign-in,sign-up,verify,reset}/page.tsx` with a shared `(auth)/layout.tsx` (see §5).
- Use server actions for submit; validate with zod; enforce the domain allow-list server-side (`ALLOWED_EMAIL_DOMAINS`) as FR-1.1 requires. The client check is a convenience only.
- Characters: `import { UxieCharacter } from "@uxie/character"` (already wired in `layout.tsx`). Never ship the PNGs.

## 3. Design tokens

All values live in `tokens.css`. Use the token classes, not raw hex.

| Token                                     | Value                                 | Usage                                                   |
| ----------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `color-ground`                            | #F6F4FB                               | Page background                                         |
| `color-surface`                           | #FFFFFF                               | Inputs, speech bubbles                                  |
| `color-panel`                             | #ECE7FA                               | Web left panel, mobile header, sign-up "next step" chip |
| `color-panel-sage`                        | #E4F1DA                               | Verify screen illustration disc                         |
| `color-ink`                               | #1F1A33                               | Headings, body, input text                              |
| `color-ink-muted`                         | #4A4563                               | Subtitles, secondary copy                               |
| `color-ink-subtle`                        | #575270                               | Hints, footer                                           |
| `color-placeholder`                       | #6E6887                               | Placeholder text                                        |
| `color-line`                              | #857F9F                               | Input border (3.8:1, meets non-text contrast)           |
| `color-line-soft`                         | #E2DCF0                               | Bubble border (decorative)                              |
| `color-primary`                           | #5135C9                               | Primary button, links, focus ring, logo tile            |
| `color-primary-hover`                     | #3A2399                               | Hover for links and primary button                      |
| `color-danger` / `-ink` / `-bg` / `-line` | #B42318 / #8A1C12 / #FDECEA / #E8A39B | Error border / text / alert bg / alert border           |
| `radius-field`                            | 12px                                  | Inputs, buttons                                         |
| `radius-alert`                            | 14px                                  | Error alert                                             |
| `radius-chip`                             | 16px                                  | Sign-up next-step chip                                  |
| `radius-sheet`                            | 32px                                  | Mobile header bottom corners                            |

Typography (load with `next/font/google`, `display: "swap"`, expose as CSS variables):

```ts
// app/layout.tsx
import { Bricolage_Grotesque, Atkinson_Hyperlegible } from "next/font/google";
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-bricolage",
});
const body = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
});
// <html className={`${display.variable} ${body.variable}`}>
```

| Style        | Family  | Size / line-height | Weight | Tracking | Used for                                                               |
| ------------ | ------- | ------------------ | ------ | -------- | ---------------------------------------------------------------------- |
| `display-xl` | display | 60 / 1.02          | 700    | -0.03em  | Web panel headline                                                     |
| `display-lg` | display | 40 / 1.1           | 700    | -0.02em  | Web form `h1`                                                          |
| `display-md` | display | 32 / 1.1           | 700    | -0.02em  | Mobile `h1`                                                            |
| `brand`      | display | 28 web / 24 mobile | 700    | -0.02em  | "UXie" wordmark                                                        |
| `body-lg`    | body    | 20 / 1.5           | 400    | 0        | Web panel subcopy                                                      |
| `body`       | body    | 17-18 / 1.45       | 400    | 0        | Subtitles, bubbles, input text (keep inputs ≥ 16 px to avoid iOS zoom) |
| `label`      | body    | 15-16              | 700    | 0        | Field labels, links                                                    |
| `hint`       | body    | 14                 | 400    | 0        | Helper and footer text                                                 |

Spacing follows Tailwind's 4 px scale. Key values: form stack gap 24 px web / 18 px mobile; label to input 8 px web / 6 px mobile; screen side padding 24 px mobile; web panel padding 56 px top, 64 px sides.

Dark mode: `globals.css` already has a dark scheme for the app, but the auth screens were designed light-only. Force light on `(auth)` for now (`color-scheme: light` on the auth layout root) and track dark auth as a follow-up.

## 4. Components

Build these as small components in `apps/web/components/auth/` on top of shadcn/ui primitives.

| Component         | Base                             | Props                                       | Notes                                                                                                                                                                                                              |
| ----------------- | -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AuthShell`       | layout                           | `variant: "split" \| "stacked"`, `children` | Owns background, logo, character panel/header, footer                                                                                                                                                              |
| `BrandMark`       |                                  | `size: "md" \| "lg"`                        | 38 px (web) / 32 px (mobile) primary tile, radius 12/10, white speech-bubble-with-question icon (see `reference/sign-in-web.html` for the SVG paths) + "UXie" wordmark. Wrap in a link to `/` only when signed in. |
| `CharacterTrio`   | `UxieCharacter` x3               | `size`                                      | Pip, Miso, Luma, bottom-aligned, overlapping by about 6% of width (−18 px web, −14 px mobile). Miso is about 7% taller and sits in the middle. All `decorative` (the headline names them).                         |
| `SpeechBubble`    | `<p>`                            | `from: "left" \| "right"`, `children`       | Uses `.uxie-bubble`. Tail corner 6 px points at the speaker. Plain text only.                                                                                                                                      |
| `CharacterLine`   | `UxieCharacter` + `SpeechBubble` | `character`, `state`, `children`            | Avatar 64 px web / 56 px alert, bubble bottom-aligned with 8 px lift                                                                                                                                               |
| `TextField`       | shadcn `Input` + `Label`         | `label`, `hint?`, `error?`, input props     | Height 52 web / 50 mobile, radius `field`, 1.5 px `line` border, 16 px x-padding. Error: 2 px `danger` border, `aria-invalid`, message below with alert-circle icon                                                |
| `PasswordField`   | `TextField`                      | `autoComplete`                              | Show/hide toggle: 44 x 44 icon button inside the right edge, `aria-label` "Show password" / "Hide password", `aria-pressed`                                                                                        |
| `PrimaryButton`   | shadcn `Button`                  | `loading?`                                  | Full width, 54 px, radius `field`, 18 px bold                                                                                                                                                                      |
| `SecondaryButton` | shadcn `Button` variant outline  |                                             | 2 px `primary` border, `primary` text, white bg                                                                                                                                                                    |
| `FormAlert`       | shadcn `Alert`                   | `title`, `children`, `character?`           | `role="alert"`, `danger-bg` / `danger-line`, title in `danger-ink` bold, optional Pip (state `puzzled`) at 56 px                                                                                                   |
| `AuthFooter`      |                                  |                                             | "Data hosted in the EU · Privacy notice" (link to the privacy notice route), 14 px `ink-subtle`                                                                                                                    |

## 5. Layout and responsive behavior

| Breakpoint                    | Sign-in layout                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ≥ 1024 px (`lg`)              | Split. Left `<section>` = character panel, `flex: 1 1 560px`, bg `panel`, contents spaced between: BrandMark (top), headline + subcopy (middle, max 560 px), bubble + `CharacterTrio` at 250-268 px tall (bottom, flush to the panel's bottom edge). Right `<main>` = form, `flex: 1 1 480px`, form max-width 420 px, centered both axes. Min height 100dvh. |
| 640-1023 px                   | Stacked like mobile, form max-width 420 px centered under the header.                                                                                                                                                                                                                                                                                        |
| < 640 px                      | Stacked. Header: bg `panel`, height 272 px, bottom corners `radius-sheet`, BrandMark top-left, bubble right-aligned (tail bottom-right), trio centered at 150/164/150 px. Form below with 24 px side padding. Page scrolls when the keyboard opens; never fix the header.                                                                                    |
| 320 px / 200% zoom (PRD §2.5) | Trio scales down with the header (use `size` from a container query or 38% of width); no horizontal scroll; bubble may wrap to 2 lines.                                                                                                                                                                                                                      |

Other auth screens use the stacked shell at all widths, centered in a 420 px column on desktop over `ground`, with the BrandMark at top-left. The verify screen's illustration disc is 240 px.

## 6. Screens, copy and behavior

Copy is final. Keep it verbatim unless a translation is added later. Domain in placeholders and errors comes from `ALLOWED_EMAIL_DOMAINS[0]` (example: `thi.de`).

### 6.1 Sign in (`/auth/sign-in`)

- Web panel headline (a `<p>`, not a heading): "Dense papers, one good question at a time."
- Web panel subcopy: "Pip, Miso and Luma help you work through UX research by asking, not telling."
- Web panel bubble: "What made that interface feel easy to use?"
- Mobile header bubble: "Ready for another good question?"
- `h1`: "Sign in"
- Subtitle: web "Your papers and conversations are where you left them." / mobile "Pick up your papers where you left them."
- Web only, under the subtitle: `CharacterLine` with Miso (state `idle`), bubble "Welcome back. Which paper are we questioning today?"
- Fields: "University email" (`type=email`, `autocomplete=username`, placeholder `name@<domain>`), "Password" (`autocomplete=current-password`) with show/hide.
- "Forgot password?" link: web to the right of the Password label; mobile right-aligned under the field (44 px tap height). Goes to `/auth/reset`, carrying the typed email as `?email=` if valid.
- Checkbox (web, optional): "Keep me signed in on this device". If Supabase session persistence cannot be toggled per sign-in in your setup, drop this control rather than faking it.
- Button: "Sign in". Loading: label "Signing in…", spinner, button disabled, inputs read-only.
- Below: "New to UXie? Create an account" (to `/auth/sign-up`).
- Footer: `AuthFooter`.
- Success: redirect to `/onboarding` if the privacy notice is not acknowledged (FR-1.3), else to `next` param if same-origin, else `/`.

### 6.2 Sign-in errors

Show a `FormAlert` at the top of the form (below `h1`) and move focus to it. Field-level messages also appear under the field and are linked with `aria-describedby`.

| Condition                | Alert title             | Alert body (Pip, state `puzzled`)                                                          | Field message                               |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Email domain not allowed | We couldn't sign you in | Hmm, that address isn't a university email. Can you try the one from your student account? | Email: "Use an address ending in @<domain>" |
| Wrong email or password  | We couldn't sign you in | That email and password don't match. Want to try again, or reset your password?            | none (never reveal which field was wrong)   |
| Email not verified       | (no alert)              |                                                                                            | Redirect to `/auth/verify?email=…`          |
| Rate limited (429)       | Too many attempts       | Let's take a short break. Try again in a minute.                                           | none                                        |
| Network or server error  | Something went wrong    | We couldn't reach UXie. Check your connection and try again.                               | none                                        |

In the error state the primary button reads "Try again". Keep the typed email; clear the password.

### 6.3 Create account (`/auth/sign-up`)

- Back button (44 x 44, `aria-label` "Back to sign in") + wordmark.
- `h1`: "Create your account"; subtitle: "For students enrolled in the course."
- "University email" (`autocomplete=email`), hint "Only university addresses can register."
- "Create a password" (`autocomplete=new-password`), hint row with a status icon + "At least 10 characters". The icon changes from empty circle to check circle when met (icon + text, never color alone). Add the show/hide toggle here too.
- "Course invite code (if your instructor gave you one)": render only when `REGISTRATION_INVITE_CODE` is configured.
- Button: "Create account".
- Next-step chip (bg `panel`, radius `chip`): mini trio at 44 px + "Next: confirm your email, then choose your UXie."
- Errors: domain (same copy as 6.2), "That password is too short. Use at least 10 characters.", leaked password (Supabase): "This password has appeared in a data breach. Please choose a different one.", invite code: "That invite code doesn't match. Check with your instructor.", email already registered: do not reveal; proceed to the verify screen exactly as for a new account.

### 6.4 Check your inbox (`/auth/verify`)

- Miso (state `idle`, size about 224 px) inside a 240 px `panel-sage` disc, bottom-aligned, clipped by the circle. `decorative`.
- `h1`: "Check your inbox"
- Body: "We sent a confirmation link to **{masked email}**. Open it on any device to finish setting up." Mask as first character + "•••" + "@domain" if you prefer not to echo the full address; the design shows the full address.
- Hint: "It can take a minute. Check your spam folder too."
- Secondary button "Resend email": disabled for 60 s after each send with label "Resend in 0:45"; after sending, announce "Email sent" via a polite live region.
- Link "Use a different email" to `/auth/sign-up`.
- The confirmation link lands on the auth callback route, which signs the user in and sends them to `/onboarding`.

### 6.5 Reset password (`/auth/reset`)

- Back button + wordmark.
- `CharacterLine`: Pip (state `hint`) at 120 px, bubble "Happens to everyone. Want a fresh one?"
- `h1`: "Reset your password"; body: "Enter your university email and we'll send you a link to set a new password."
- "University email" field, prefilled from `?email=`.
- Button: "Send reset link". On submit always show the same confirmation (no account enumeration): replace the form with "If that address has an account, a reset link is on its way." plus "Back to sign in".
- Link: "Back to sign in".

## 7. States and interactions

| Element                 | State              | Behavior                                                                                  |
| ----------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| Primary button          | Hover              | bg `primary-hover`                                                                        |
| Primary button          | Active             | translateY(1px)                                                                           |
| Primary button          | Disabled / loading | opacity 0.6 on bg only (keep text contrast), `aria-disabled`, spinner 18 px left of label |
| Link                    | Default / hover    | `primary`, bold / `primary-hover`, underline on hover                                     |
| Input                   | Focus              | 3 px `primary` outline, 2 px offset (from `tokens.css`)                                   |
| Input                   | Invalid            | 2 px `danger` border + message; outline still `primary` on focus                          |
| Show/hide toggle        | Pressed            | Icon switches eye to eye-off; label switches; focus stays on the toggle                   |
| Any interactive element | Focus-visible      | Same 3 px ring. Never remove outlines.                                                    |

Minimum touch target 44 x 44 px everywhere, including inline links (pad vertically).

## 8. Motion

Use `@uxie/character` states; it already handles `prefers-reduced-motion`.

| Element            | Trigger                   | Animation                                                                                       | Duration        | Easing   |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------- | --------------- | -------- |
| Trio               | Page load                 | `idle` loop (from the package), start each character offset by 400 ms so they don't bob in sync | package default | package  |
| Pip in error alert | Alert appears             | `puzzled`, then back to `idle` after 2 s                                                        | package         | package  |
| Field focus        | Email or password focused | Optional: trio switches to `listening` while typing, back to `idle` on blur                     | instant         |          |
| Successful sign-in | Submit OK                 | Optional `flash("celebrate")` on Miso before redirect, max 600 ms; skip if reduced motion       | 600 ms          |          |
| Alert              | Appears                   | Fade + 4 px slide down                                                                          | 160 ms          | ease-out |

## 9. Edge cases and open items

- Long emails: inputs scroll horizontally inside the field; the verify screen wraps the address with `overflow-wrap: anywhere`.
- Slow network: keep the button in loading state; after 10 s show the network error.
- JS disabled: forms must still post via server actions.
- Already signed in: visiting any `/auth/*` page except the callback redirects to `/`.
- Not designed yet (build to match this system): "Set new password" page after the reset link (fields: "New password" with the 10-character hint, "Confirm new password"; button "Save new password"; Pip bubble "Fresh start. What will it be?"), and the "link expired" state for both verify and reset links ("That link has expired. Want a new one?" + resend button).
- Character choice is NOT part of auth. It happens on `/onboarding` after verification.

## 10. Accessibility checklist (WCAG 2.2 AA, PRD §2.5)

- One `h1` per screen. The web headline in the panel is a `<p>` styled large.
- Landmarks: panel is `<section aria-label="About UXie">` (or `aside`), form column is `<main>`. Add a skip link to `#main`.
- Focus order: skip link, (back button), email, password, show/hide toggle, forgot-password link, checkbox, submit, create-account link, footer links. On web, the forgot-password link sits visually next to the Password label but comes after the password field in DOM order.
- Every input has a visible `<label>`; hints and errors are linked with `aria-describedby`.
- Errors: `FormAlert` uses `role="alert"` and receives focus on submit failure.
- Characters are `decorative` (aria-hidden) on these screens; bubbles are real text.
- Contrast: all text pairs ≥ 4.5:1 (lowest is placeholder at 4.8:1 on `ground`, 5.3:1 on white); input borders 3.8:1; focus ring 7.8:1.
- `autocomplete` values as listed so password managers work; never block paste.
- Test at 320 px width and 200% zoom.
