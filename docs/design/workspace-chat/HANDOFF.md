# Handoff spec: UXie paper workspace and chat (`/papers/[paperSlug]`)

Status: design ready for implementation (web and mobile chat; chat-pane states on web).
Source of truth: the "UXie Chat Workspace" design canvas. This folder is the coding-agent copy.
Implements PRD §2.4 (workspace layout), §2.5 (accessibility), journeys J2 and J3, FR-3.1 to FR-3.8 and FR-4.1, FR-4.3, FR-4.7.

## 0. What is in this folder

| Path                         | What it is                                    | How to use it                                                                                       |
| ---------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `HANDOFF.md`                 | This spec                                     | Read first. Wins over the reference HTML if they disagree.                                          |
| `tokens.css`                 | Token ADDITIONS for this screen + 3 utilities | Add to the `@theme` block in `apps/web/app/globals.css`. Base tokens: `../login/tokens.css`, `../library/tokens.css`. |
| `reference/*.html`           | Static exports of each state (inline styles)  | Open in a browser for visual comparison. Do NOT copy the markup; rebuild with Tailwind + shadcn/ui. |
| `assets/{pip,miso,luma}.png` | Character cut-outs (same as login, library)   | Visual reference only. In the app, render characters with `@uxie/character`.                        |

Reference file to state mapping (all references use Miso; the character comes from `profiles.uxie_character`):

| Reference                       | Route / state                                        | Notes                                                       |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `workspace-web.html`            | `/papers/[slug]?c=<id>`, ≥ 1024 px, view "Both"      | Default state: waiting for the student                      |
| `workspace-web-replying.html`   | same, while a reply streams                          | Input disabled, Stop button, typing indicator               |
| `workspace-mobile.html`         | same, < 1024 px, Chat tab                            | Read / Chat tabs instead of split view                      |
| `chat-empty-web.html`           | `/papers/[slug]` with no conversation                | Chat pane only (620 px wide); starter questions             |
| `chat-progress-web.html`        | Progress drawer open                                 | Chat pane only; drawer over the chat                        |
| `chat-error-reply-failed.html`  | Provider failure on a turn                           | Chat pane only                                              |
| `chat-error-rate-limit.html`    | Per-minute rate limit                                | Chat pane only                                              |
| `chat-error-daily-limit.html`   | Daily message limit                                  | Chat pane only                                              |
| `chat-error-paused.html`        | Spend ceiling reached ("UXie is paused")             | Chat pane only                                              |

The paper (the synthetic "Visible Cues" fixture in `fixtures/papers/visible-cues`), messages and counts in the references are sample content.

## 1. Overview

The workspace is where reading and dialogue happen side by side. The chat is a Socratic exchange: UXie asks exactly one question per turn, cites pages, and labels illustrations. Design priorities, in order:

1. **The current question is unmistakable.** The question that ends each tutor turn is set in bold.
2. **The paper is one click away.** Every `[p. N]` becomes a citation chip that opens the page and highlights the cited passage.
3. **There is always a way out.** "Explain it to me" is always visible next to the input (PRD principle 1).
4. **Reading never requires chatting.** No conversation exists until the first chat action (FR-3.2).

Voice: the student's character speaks only in tutor bubbles and the empty-state greeting. Labels, buttons, statuses and errors stay plain and literal.

## 2. Layout (web, ≥ 1024 px)

Full-height app shell (`h-dvh`, min 720 px); the page itself never scrolls, the panes do.

1. **Top bar** (white, bottom border `line-soft`, padding 10/24):
   - "← Library" link (`bg-panel`, `text-primary-hover`, 44 px) to `/`.
   - Eyebrow "Module N · <module title> · Paper M" (14 px, `ink-muted`) over the paper title (display 20, one line, ellipsis; full title in `title` attribute).
   - View switcher on the right: segmented group of three toggle buttons "Read", "Chat", "Both" with icons, `role="group" aria-label="View"`, `aria-pressed` on the active one (white pill with shadow on a `ground` track). Persist per user in `localStorage` inside try/catch (FR-3.1). Default "Both".
2. **Body:** two panes in a row.
   - **Reader pane** (`flex: 1 1 0`, `bg-reader-ground`): see §3.
   - **Chat pane** (`flex: 0 1 620px; max-width: 620px`, white, left border `line-soft`): see §4.
   - "Read" or "Chat" view shows only that pane at full width (chat content max 760 px, centered).

## 3. Reader pane

- **Toolbar** (`role="toolbar" aria-label="Paper tools"`, white): previous page, "Page N of M", next page | zoom out, zoom %, zoom in, search (icon buttons, 44 × 44, `aria-label` each) | spacer | "Accessible text" toggle button (`aria-pressed`, outline `line`). The extraction warnings banner (FR-3.3) sits directly below the toolbar when the current page has warnings (not drawn; use the alert style from login: `danger-bg` is too strong, use `bg-panel` + info icon).
- **Page**: pdf.js canvas centered, max 680 px, white, radius 6, soft shadow, padding 28/32 around it on `reader-ground`.
- **Citation highlight**: when a citation chip is activated, scroll to the page, then highlight the cited region with `bg-cite-bg` and a 2 px `cite-line` outline, plus a dark tag "Cited in chat · p. N" (ink background, white 13 px bold) at its top right. If no text region can be located, highlight the whole page outline instead. Fade the highlight after 4 s; keep it while hovered or focused. Move focus to the page container (`tabindex="-1"`, `aria-label="Page N"`) so screen readers follow.

## 4. Chat pane

Three stacked parts: header, message log (scrolls), composer.

### 4.1 Header

- **Focus mode** (`role="group" aria-label="Focus mode"`): pill toggle buttons "Understand", "Apply to UX", "Critique", "Build" (44 px, radius pill). Active: `bg-primary` white text; inactive: white, border `progress-empty` (#C9C0E8), `text-primary-hover`. Critique and Build are P1: hide them until enabled (do not show disabled pills). Switching mode calls `POST /api/conversations/:id/mode` and streams the one-line handover (FR-4.7). With no conversation yet, selecting a mode creates it (FR-3.2).
- **Progress button** (right, `bg-ground`, radius 12, `aria-haspopup="dialog"`): one segment per objective (22 × 6, gap 3; `primary` = in progress, `success-mark` = demonstrated, `progress-track` = not started; `aria-hidden`) over the text "Progress: x of y ideas, z in progress". With no conversation: "Progress: y ideas to explore". Opens §4.5.

### 4.2 Message log

`role="log" aria-live="polite" aria-label="Messages"`, padding 24/20, gap 18, body 17/1.5. Announce completed tutor messages only, never each token (PRD §2.5): render the streaming text in a sibling `aria-hidden` element and append the final text to the live region on completion.

- **Student message**: right-aligned, max 82 %, `.uxie-bubble--student` (primary background, white text, tail bottom right), padding 12/16.
- **Tutor message**: left column offset 68 px (aligns with the character), max 88 %.
  - Name line above the bubble: "<Character>" (14 px bold, `ink-muted`). When `help_level` is `hint`, append " · Hint"; `explain` → " · Explanation"; `check` → " · Check". This tells the student why the reply looks different without an emoji.
  - Bubble: `.uxie-bubble` from login (white, `line-soft` border, tail bottom left), padding 12/16, inner gap 10–12.
  - Markdown rendered safely (no raw HTML). The final question of the turn is bold: the tutor prompt already ends each turn with one question; the client wraps the last sentence ending in "?" in `<strong>` (keep it simple: last paragraph's last question sentence).
  - **Citation chip** for each valid `[p. N]` / `[p. N–M]`: inline `<button>` "p. N", pill, `bg-panel`, `text-primary-hover`, 14 px bold, padding 1/9, `aria-label="Open page N in the paper"`. On mobile it also switches to the Read tab.
  - **Illustrative example block** for text starting `💡 Illustrative example:`: strip the emoji, render a block with `bg-illustration-bg`, radius 12, padding 12/14; label row with a lightbulb stroke icon and "Illustrative example, not from the paper" (14 px bold, `success-ink`); body 16 px. No left border.
  - **Feedback** below the bubble: two icon buttons "Helpful" / "Not helpful" (`aria-label`, 44 × 36, `ink-subtle`, thumb stroke icons, `aria-pressed` once chosen). "Not helpful" opens an optional comment field (≤ 1000 chars) inline below (FR-3.6).
- **Character presence**: only the LATEST tutor message shows the character (56 px wide, bottom-aligned with the bubble, `decorative` since the name line names UXie). Earlier tutor messages keep the 68 px offset without the image. This keeps one "living" speaker on screen.
- **Auto-scroll** to the newest message unless the student has scrolled up; then show a "New message ↓" pill above the composer.

### 4.3 Composer

`<form>`, top border `line-soft`, padding 14/20/16, gap 10.

- Visible label "Reply to <Character>" (15 px bold) for the textarea.
- Textarea (min 56 px, grows to 6 lines, border `line`, radius 12, 17 px) with placeholder "Type your answer. It’s fine to think out loud." Enter sends, Shift+Enter adds a line; show that hint as 14 px `ink-subtle` text at the right of the action row.
- Primary "Send →" button (56 px tall).
- Action row: outline "Explain it to me" (lifebuoy icon; sends `event: "stuck"`) and ghost "Start over" (rotate icon; opens a confirm dialog, then `POST /api/conversations/:id/reset`, FR-3.5).
- Send sends `{ clientMessageId, text }` to `POST /api/conversations/:id/messages` via `useChat` (only the latest message, per PRD §11).

### 4.4 Replying state (`workspace-web-replying.html`)

While a reply streams: textarea disabled (`bg-ground`, border `progress-empty`, placeholder "Wait for <Character> to finish…"), Send replaced by outline "Stop" (filled square icon; aborts client display only, FR-3.4), "Explain it to me" disabled. Before the first token, the bubble shows three pulsing dots (`.uxie-typing-dot`, primary); during streaming, text plus the dots at the end; below the bubble "<Character> is writing a reply…" (14 px, `ink-subtle`, not in the live region).

### 4.5 Progress drawer (`chat-progress-web.html`)

Opens from the progress button. Right-side sheet over the chat pane, 460 px (full width below 640 px), `role="dialog" aria-modal="true"` labelled by its heading, scrim `--color-scrim`, focus trapped, `Esc` and the close button (44 px, `aria-label="Close progress"`) return focus to the progress button. Use shadcn `Sheet`.

- Header (`bg-panel`, padding 22/20/18/24): `h2` "Your progress" (display 26), segments (40 × 8), "**x of y ideas demonstrated** · z in progress".
- Intro line (15 px, `ink-muted`): "These are the key ideas of this paper. An idea counts as demonstrated when you explain it in your own words in the chat."
- Ordered list of objectives in guide order, each a card (border `line-soft`, radius 16, padding 16, gap 10):
  - Kind eyebrow (13 px bold caps, `ink-muted`): "Understand", "Apply to UX", "Critique". The active objective adds " · Current" and gets a `primary` border.
  - Status chip, same as library §3 wording and colors: "Demonstrated" (`success-bg`, `success-ink`, check), "In progress" (`bg-panel`, `text-primary-hover`, chat icon), "Not started" (plain, `ink-subtle`, empty circle). Never color alone.
  - Objective `statement` (17 px bold).
  - Demonstrated only: "What you said" box (`bg-ground`, radius 12) with the `evidence` sentence in quotes.
  - "In the paper:" + citation chips from `refs`.
  - Not started and `kind` differs from the current mode: outline button "Work on this in <Mode> mode" (switches mode and closes the drawer). Hide the button for P1 modes until enabled.
- Data: `GET /api/conversations/:id` progress (statements, statuses, evidence, refs). Never show guide internals (hints, ladder, mastery checks).
- When an objective becomes demonstrated during a turn (final metadata part `progress`), flash the character's `celebrate` state and announce "Idea demonstrated: <statement>" politely.

### 4.6 Empty conversation (`chat-empty-web.html`)

Shown when no conversation exists for this paper and user.

- Character (104 px, idle) + bubble (18 px): "Hi! I’ll ask the questions, you do the thinking. Pick one below to start, or ask me anything about this paper." (fixed copy; the real greeting is generated by the tutor on `start`, FR-4.1).
- `h2` "Start with a question", then the guide's `starter_questions` (2–4) as a list of full-width buttons (min 60 px, border `progress-empty`, radius 16, 17 px, arrow icon; hover border `primary`, bg `ground`). Clicking one calls `POST /api/conversations` and sends the question as the first student message.
- Bottom note with book icon (15 px, `ink-muted`): "Just want to read first? Go ahead. Nothing is saved as a conversation until you send a message or pick a question."
- Composer label "Or ask your own question", placeholder "For example: what does “signifier” mean here?". No "Explain it to me" or "Start over" yet.
- Progress button reads "Progress: y ideas to explore" with all segments empty.

### 4.7 Errors and limits (FR-3.7)

The last student message always shows "✓ Saved" (13 px, `ink-subtle`, check icon) under its bubble once persisted, so students know nothing was lost. The error appears where the tutor reply would be, next to the character in its resting look (`.uxie-resting`). The composer action row shows an outline link "Keep reading the paper" (switches to Read on mobile, focuses the reader on web).

| Error (API `code`)        | Panel                                              | Title / body                                                                                                       | Composer                                          |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Provider failure          | `role="alert"`, `danger-bg`, border `danger-line`  | "<Character> couldn’t reply" / "Something went wrong on our side, not with your answer. Your message is saved." + primary "Try again" (idempotent, same `clientMessageId`) | Enabled                                           |
| Rate limit                | `role="status"`, `bg-panel`                        | "A short pause" / "You’re sending messages quickly. <Character> can answer again in **N seconds**. A good moment to check the page in the paper." Live countdown. | Disabled, placeholder "You can send again in N seconds" |
| Daily limit               | `role="status"`, `bg-panel`                        | "That’s it for today" / "You’ve reached today’s message limit. Chat opens again at **HH:MM** (in X h Y min). Your conversation is saved, and the paper stays open for reading." Local time from the API reset time. | Disabled, "Chat opens again at HH:MM"             |
| Spend ceiling (paused)    | `role="status"`, white, border `line`              | "UXie is paused" / "Chat is unavailable for the whole course right now, and your instructor knows. You can keep reading, and your conversation is saved for later." | Disabled, "Chat is paused for now"                |

Disabled composer: textarea `bg-ground`, border `progress-empty`; Send `bg-line-soft`, `ink-muted`. "Paper unavailable" is a full-page state, not designed here.

## 5. Mobile (< 1024 px, `workspace-mobile.html`)

- Header (`bg-panel`, bottom radius 24): back icon link (`aria-label="Back to library"`), eyebrow "Module N · Paper M", title (display 18, ellipsis); below it a two-tab control "Read" / "Chat" (`role="tablist"`, `aria-selected`; selected tab `bg-primary` white) on a white track.
- Chat header row: mode as a single pill button "Mode: Understand ▾" opening a listbox/menu of modes; compact progress button (12 px segments + "x of y ideas").
- Log on `bg-ground` with a top border, messages bottom-aligned; the character (44 px) sits above the latest tutor bubble next to the name, bubble tail top left.
- Composer: label, single-line growing textarea (50 px), icon-only Send (50 × 50, `aria-label="Send"`); action row with full-width-flex "Explain it to me" and ghost "Start over".
- Citation chips switch to the Read tab and highlight there; the Read tab shows a "Back to chat" pill while a highlight is active.
- The progress drawer becomes a bottom sheet (90 % height). Errors and the empty state use the same content as web, stacked.

## 6. Character (`@uxie/character`)

Render with `<UxieCharacter character={profile.uxie_character} state={state} decorative />` and drive `state` with `stateForTurn()`:

| UI moment                               | Character state             |
| --------------------------------------- | --------------------------- |
| Waiting for the student                 | `idle`                      |
| Student typing in the composer          | `listening`                 |
| Request sent, before the first token    | `thinking`                  |
| Streaming (help `ask` / `check`)        | `talking`                   |
| Streaming with help `hint` / `explain`  | `hint` / `explain`          |
| Off-topic or shortcut request           | `puzzled`                   |
| Objective becomes demonstrated          | `celebrate` (transient)     |
| Blocking error (§4.7)                   | `idle` with the `paused` prop, plus `.uxie-resting` |

Sizes: 56 px latest message (web), 44 px (mobile), 104 px empty state. All motion respects `prefers-reduced-motion` (the package handles it).

## 7. Accessibility

WCAG 2.2 AA (PRD §2.5). Skip link "Skip to chat" and "Skip to paper". Landmarks: `header`, `main` holding two labelled `section`s ("Paper", "Conversation with <Character>"). All controls are real `<button>`, `<a href>`, `<textarea>` + `<label>`; targets ≥ 44 px (inline citation chips are exempt as inline targets but keep 24 px height). Focus ring from `../login/tokens.css`. Keyboard: Enter/Shift+Enter in composer; `Esc` closes the drawer; citation chips reachable by Tab in reading order. Contrast: all text pairs used here are ≥ 4.5:1 (white on `primary` 7.8:1, `success-ink` on `illustration-bg` > 7:1). Status by icon + text, never color alone. 320 px width and 200 % zoom: the split view collapses to tabs.

## 8. Data

Per PRD §11: `GET /api/papers/:slug?c=` (paper, version, pages, warnings, conversation summary), `GET /api/conversations/:id` (messages with `citations`, `help_level`, mode, progress), `POST /api/conversations` (start), `POST /api/conversations/:id/messages` (stream; final metadata `{ tutorMessageId, citations, progress }`), `POST …/mode`, `POST …/reset`, `POST /api/messages/:id/feedback`. The UI needs `help_level` on each tutor message (for the name-line suffix and character state) and the starter questions for the empty state; check both are in the payloads and add them if not (starter questions are not guide internals).

## 9. Open questions

1. **Bold final question.** Client-side detection (last sentence ending in "?") is assumed. Alternative: have the tutor prompt wrap it in `**…**`.
2. **Help-level label.** "· Hint" / "· Explanation" on the name line is assumed helpful; confirm it doesn't feel like grading.
3. **Superseded-version banner** (FR-3.8) is not designed yet: proposed as a `bg-panel` bar under the chat header with "A newer version of this paper is available" and a link "Start a new conversation on the current version".
4. **Mobile versions** of the empty, progress and error states are described in §5 but not drawn.
