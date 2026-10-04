# Handoff spec: UXie paper library (`/`)

Status: design approved (web and mobile).
Source of truth: the "UXie Paper Library" design canvas. This folder is the coding-agent copy.
Implements PRD §2.3 row "Library" (`/`), journey J2 (Library → module → paper → workspace, resume later), FR-2.1, FR-2.2 and FR-2.3.

## 0. What is in this folder

| Path                         | What it is                                             | How to use it                                                                                       |
| ---------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `HANDOFF.md`                 | This spec                                              | Read first. Wins over the reference HTML if they disagree.                                          |
| `tokens.css`                 | Token ADDITIONS for this screen                        | Add to the `@theme` block in `apps/web/app/globals.css`. Base tokens: `../login/tokens.css`.        |
| `reference/*.html`           | Static exports of each state (inline styles)           | Open in a browser for visual comparison. Do NOT copy the markup; rebuild with Tailwind + shadcn/ui. |
| `assets/{pip,miso,luma}.png` | Character cut-outs (same as login)                     | Visual reference only. In the app, render characters with `@uxie/character`.                        |

Reference file to state mapping:

| Reference                           | Route / state                          | Notes                                              |
| ----------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `library-web.html`                  | `/` (≥ 1024 px), no query              | Default state                                      |
| `library-search-web.html`           | `/?q=affordance`                       | Search results, title hits highlighted             |
| `library-search-empty-web.html`     | `/?q=<no match>`                       | Empty results and empty conversation list          |
| `library-mobile.html`               | `/` (< 1024 px)                        | Module tabs instead of stacked modules             |

The papers, modules and conversation texts in the references are sample content. Real data comes from `GET /api/library`.

## 1. Overview

The library is where a student lands after sign-in. It offers three ways in, in this order of prominence:

1. **Resume:** continue the most recent active conversation.
2. **Go in order:** the next paper in course order, then every module with its papers in `position` order.
3. **Find:** search across papers and the student's own conversations.

Principle 5 of the PRD applies throughout: opening a paper never starts a conversation. "Open paper" goes to `/papers/[slug]`; "Continue" goes to `/papers/[slug]?c=<conversationId>`.

Voice: the student's chosen character speaks only in the speech bubble (greeting, search hint, empty state). Labels, buttons and statuses stay plain and literal.

## 2. Layout (web, ≥ 1024 px)

Container `max-width: 1280px`, side padding 32 px, page padding 40 px top / 80 px bottom, vertical gap 28 px.

1. **Top bar** (white, bottom border `line-soft`): logo + "UXie" wordmark, main nav (`Library` current with `aria-current="page"`, `My conversations` → `/conversations`), `Account` → `/account` on the right.
2. **Intro row:** `h1` "Your library" (display 48/1.05) on the left; on the right the character (112 px tall) and a speech bubble.
   - Default bubble: a nudge toward the most recent conversation ("Welcome back. Shall we pick up Gaver's affordances where we stopped?"). Generate from the most recent conversation's paper; fall back to "Welcome back. Which paper are we questioning today?" when there is none.
   - While searching: "I'm searching titles, authors, key concepts and our past conversations."
3. **Search field** (full width, 56 px, visible label "Search papers and your conversations"). See §5.
4. **Pick-up row** (hidden while searching): two cards in a wrapping flex row, gap 20 px.
   - **Continue card** (`flex: 2 1 520px`, `bg-panel`, radius 20, padding 28): eyebrow "Continue where you left off"; paper title (display 32); `authors · year · Module N, paper M`; character (60 px) + bubble with "<Character> asked: <last tutor question>"; progress segments + "x of y ideas demonstrated · <Mode> mode · <relative time>"; primary button "Continue conversation →".
   - **Next in order card** (`flex: 1 1 320px`, white, border `line-soft`): eyebrow "Next in order"; number badge (e.g. `1.3`) + "Module 1 · Foundations"; title (display 22); byline; outline button "Open paper" with book icon; hint "Opening a paper doesn't start a conversation. Read first if you like."
5. **Two columns** (wrapping flex, gap 40 px): main column `flex: 999 1 560px`, side column `flex: 1 1 320px`. The side column drops below the main column on narrow screens.

### 2.1 Main column (not searching)

- **Module tiles:** `h2` "Work through the modules in order", then an ordered list of tiles in a grid `repeat(auto-fit, minmax(200px, 1fr))`, gap 12. Each tile is a link to its module section (`#module-N`): "Module N", title, one progress segment per paper, "x of y papers discussed". The tile of the module holding the next-in-order paper gets a `primary` border.
- **Module sections** (gap 44 between sections): eyebrow "Module N", `h2` title (display 30), "x of y papers discussed" right-aligned. No module description on this screen (removed on purpose to reduce text).
- **Paper rows** (ordered list, gap 10; white, border `line-soft`, radius 16, padding 16/20): number badge `N.M` → title (link to `/papers/[slug]`) and `authors · year` → status chip → action button. The next-in-order row gets a `primary` border and a small "Next in order" tag above the title.

### 2.2 Side column: "Your conversations"

`h2` "Your conversations" + "See all" → `/conversations`. Up to 4 cards, most recent first (`last_message_at desc`). Each card: "Module N, paper M" and relative time; paper title (link); "<Character> asked: <last tutor question>"; mode chip (Understand / Apply to UX / Critique / Build); "Earlier version" chip if the conversation is on a superseded version; link "Continue →" (active, current version) or "Open →" (earlier version, read-only).

## 3. Paper status (FR-2.2)

Status is never shown by color alone: every chip has an icon and text.

| Status                     | Condition                                                              | Chip                                                  | Action                         |
| -------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| In conversation · x of y ideas | Active conversation on the current version, not all objectives demonstrated | `bg-panel`, `text-primary-hover`, chat icon      | Primary "Continue" (`?c=`)     |
| All ideas demonstrated     | Active conversation on the current version, all objectives demonstrated | `bg-success-bg`, `text-success-ink`, check icon     | Outline "Revisit" (`?c=`)      |
| Earlier version discussed  | Only conversations on superseded versions                             | Outline `line`, `text-ink-muted`, history icon        | Outline "Open paper"           |
| Not started                | No conversation                                                        | Plain `text-ink-subtle`, empty circle icon            | Outline "Open paper"           |

"Ideas" are the teaching guide's learning objectives; x = objectives with status "Demonstrated" in the conversation's learner state, y = objectives in that paper version's guide.

**Next in order** = the first paper, in module `position` then paper `position` order, with status "Not started". If none is left, hide the Next card and give the Continue card the full row.

Progress segments (module tiles, Continue card): one segment per paper (tiles) or per objective (Continue card). Filled `primary` = in progress, `success-mark` = demonstrated, empty = `progress-track` on white or `progress-empty` on lavender. Always paired with the text count; the segments are `aria-hidden`.

## 4. Data

`GET /api/library` already returns modules → papers with conversation hints (PRD §11). This screen also needs, per paper: `status` as in §3, `objectivesDemonstrated`, `objectivesTotal`, `activeConversationId`; and a `recentConversations` list (max 4) with `conversationId`, `paperSlug`, `mode`, `lastTutorQuestion` (the last tutor message, trimmed to one sentence), `lastMessageAt`, `isSupersededVersion`. Retired papers and archived modules are excluded (FR-2.3); their conversations stay reachable from `/conversations`.

## 5. Search

- Client-side filter over the library payload; no extra request. Debounce 150 ms. Mirror the query in the URL as `?q=` (replace, not push) so the state survives reload and back.
- Papers match on title, authors, module title and the guide's `key_concepts`. Results keep course order and show the module label ("Module 2 · Perception · Paper 1") above the title.
- Title hits are wrapped in `<mark>` (`bg-highlight`). Do not add horizontal padding to the mark; it visibly splits a partially matched word ("Affordance|s"). When the match is not in the title, show a hint line: "Matches an author" or "Matches a key concept in this paper".
- While searching: the pick-up row and module list are hidden, the heading reads "N papers match "query"" with a "Back to all modules" button that clears the query, and the side column becomes "Matching conversations" (match on paper title and last tutor question).
- Empty states: character + "Nothing in this course matches that yet. Try an author's surname or a concept, like "mapping" or "memory"."; side column: "None of your conversations mention that."
- Clear button (icon-only, `aria-label="Clear search"`) appears when the field has text. `Esc` in the field also clears it.
- Announce the result count via the results heading (`aria-live="polite"`).

## 6. Mobile (< 1024 px)

- Top bar: logo + wordmark, character (40 px) on the right. Main nav moves to a bottom tab bar: Library (current), Conversations, Account; icon + label, 52 px tall targets.
- Order: `h1` (display 32) and "Three modules, nine papers." (generate from counts); search field (50 px); Continue card (full width, button full width); "Work through in order" with a segmented control of module tabs (`role="tablist"` with `aria-selected`, or toggle buttons with `aria-pressed` as in the reference); the selected module's title, "x of y discussed" and its paper rows. The Next in order card is not shown separately; the next paper is marked in its module's list.
- Default tab: the module that holds the next-in-order paper.
- Paper rows are whole-row links (title, byline, status chip stacked). Tapping goes to Continue (`?c=`) when a conversation is active, otherwise to the paper.
- At widths between 390 and 1023 px the web layout's columns already stack; use the mobile pattern (tabs + bottom bar) below 1024 px for consistency with the workspace (PRD §2.4).

## 7. Accessibility

WCAG 2.2 AA (PRD §2.5). Landmarks: `header`, `nav[aria-label="Main"]`, `main`, `nav[aria-labelledby]` for module tiles, `aside` for conversations, one `section` per module labelled by its `h2`. Lists are real `ol`/`ul`. All actions are `<a href>` or `<button>`; targets ≥ 44 px. Decorative character images use `alt=""`. Focus ring from `../login/tokens.css`. Supports 320 px width and 200% zoom without horizontal scroll.

## 8. Open questions

1. **Many modules.** Tiles wrap into rows and sections stack, so the page scrolls vertically. This works up to about 4 to 5 modules. For larger courses, decide between a horizontal stepper, collapsing finished and future modules to one-line headers, or tabs on web too.
2. **Bubble copy generation.** Is the greeting a fixed template from the most recent conversation, or generated by the tutor? A template is assumed.
3. **"Revisit" target.** Assumed to reopen the existing conversation; confirm it should not start a new one.
