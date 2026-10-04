# Manual tests

Scripted checks per milestone (PRD §16). Run them before closing a milestone and note the date.

## M0: Foundations

1. Clean clone: `pnpm install && pnpm check` passes.
2. Forbidden import fails the dependency rules:
   - add `import "../../db/src/index";` to `packages/tutor/src/index.ts` → `pnpm depcruise` reports `tutor-boundaries`;
   - add `import { readFileSync } from "node:fs";` to a file in `packages/core/src` → reports `core-is-pure` and `core-no-node-builtins`;
   - revert both; `pnpm depcruise` is clean.
3. `pnpm uxie --help` lists every command from PRD §10.10; `pnpm uxie doctor` prints the provider summary without secrets.
4. `pnpm --filter @uxie/worker dev` logs `worker started` and a `heartbeat` line every `WORKER_POLL_MS`; Ctrl+C logs `worker stopped`.
5. `pnpm dev` → http://localhost:3000 shows the UXie placeholder with the animated character; `/api/health` returns `{"ok":true}`.
6. Walking skeleton: the Vercel preview URL (region `fra1`) serves the placeholder; the Render `uxie-worker` log shows heartbeats. Both redeploy on push to `main`.

Last run: 2026-10-03 (steps 1–5 locally; step 6 pending account setup).

## M1: Pedagogical core

Automated: `pnpm check` (coverage gate ≥ 95% lines on `core/state` and `core/citations`).

1. `pnpm test:coverage` → the coverage table shows `core/src/state` and `core/src/citations` at ≥ 95% lines.
2. Edit `fixtures/papers/visible-cues/guide.yaml`: set one ref to `page: 99`.
   `pnpm vitest run packages/core` fails in `guide.test.ts`, naming
   `objectives[n].refs[m].page: page 99 does not exist (paper has 7 pages)`. Revert.

Last run: 2026-10-03.

## M2: LLM gateway, tutor engine, CLI chat

Automated: `pnpm check` (gateway wire format against a fake Anthropic API, engine integration
tests on the mock provider, golden prompt snapshots in `packages/tutor/src/__tests__/__snapshots__/prompts/`).

1. Offline: `pnpm uxie chat visible-cues --provider mock --debug`. Type an answer, `/stuck` twice,
   `/mode apply`, `/progress`, `/quit`. Expect help levels ask → hint 1 → hint 2 → explain, the mode
   handover, and `cached` > 0 on tutor calls from turn 2.
2. Anthropic (real provider): in `.env` set `LLM_PROVIDER=anthropic`, `LLM_API_KEY=…`,
   `LLM_TUTOR_MODEL=claude-sonnet-5-5`, `LLM_STATE_MODEL=claude-haiku-4-5`. Run
   `pnpm uxie doctor --ping`, then `pnpm uxie chat visible-cues --debug` for ~6 turns
   (one wrong answer, one `/stuck`, one good answer). Check:
   - replies are short, cite pages like `[p. 2]`, end with one question, and follow the help level;
   - the `assessment` line shows sensible intent/quality and the state diff matches;
   - `tutor … cached N` with N > 0 from the second tutor turn on (M2 acceptance);
   - session cost stays in the cents.
3. Provider switch: run the same chat with only env changed to
   `LLM_PROVIDER=openai_compatible LLM_BASE_URL=http://localhost:11434/v1 LLM_TUTOR_MODEL=<model>`
   (needs a GPU-backed Ollama with a context ≥ 8k; CPU-only machines time out).

Last run: 2026-10-03.

- Step 1 (mock): pass.
- Step 2 (Anthropic, Sonnet 5.5 tutor + Haiku 4.5 state): pass. Coherent Socratic dialogue with
  valid page citations and one question per reply; misconception recorded and later resolved;
  shortcut declined with a smaller step; Apply-mode handover. Stable prefix 5,696 tokens written
  on turn 1 and read from turn 2 on. €0.016 for the opening, €0.004–0.006 per later tutor turn,
  €0.002 per assessment; 6-turn session €0.049. Found and fixed: on "Explain it to me" at hint
  level, the event note overrode the HINT directive (tutor/events/stuck.md tightened, re-tested).
  Noted for M4 tuning: Haiku kept U1 at in_progress although the restatement arguably met the
  mastery check; assessment calls are not cached (prefix below Haiku's 4,096-token minimum).
- Step 3 (Ollama): CPU-only machine with a 4k context timed out, exercising the timeout path.

### M2 addendum: OpenAI and Gemini (ADR-020)

Automated: request bodies for OpenAI (`store: false`, `prompt_cache_key`, no temperature on
reasoning models, `reasoning.effort`) and Gemini (`systemInstruction`, `thinkingLevel`,
JSON output, cache reads) against fake APIs; mixed-provider routing; settings redaction and
update semantics; key encryption round-trip and tamper detection.

With real keys:

1. OpenAI only: `LLM_PROVIDER=openai LLM_API_KEY=sk-… LLM_TUTOR_MODEL=gpt-5.5 LLM_STATE_MODEL=gpt-5.4-mini`
   → `pnpm uxie doctor --ping` (both roles answer), then `pnpm uxie chat visible-cues --debug`;
   `cached` > 0 from turn 2 once the prefix exceeds 1024 tokens.
2. Gemini only: `LLM_PROVIDER=google LLM_API_KEY=… LLM_TUTOR_MODEL=gemini-3.8-flash LLM_STATE_MODEL=gemini-3.5-flash-lite`.
3. Mixed: `LLM_PROVIDER=anthropic LLM_API_KEY=sk-ant-… LLM_STATE_PROVIDER=google GEMINI_API_KEY=…
LLM_STATE_MODEL=gemini-3.5-flash-lite` → the debug lines show `tutor … anthropic` and
   `assessment … google`.
   Set `LLM_PRICES_JSON` entries for OpenAI/Gemini models, or costs show €0.

## M3: Ingestion and guide drafting

Automated (`pnpm check`): both fixture PDFs ingest with the right page count; running headers and
page-number footers are stripped; the figure-only page of `scanned-page` raises
`scanned_or_figure_only`; references start pages are found; the mock provider's guide validates;
invalid draft → repair retry → still-invalid draft saved with its issues; a PDF without text →
version failed; docling response parsing; CLI output files and no-overwrite behaviour.

With a real provider (needs `LLM_API_KEY`):

1. `pnpm uxie ingest fixtures/papers/scanned-page/source.pdf --paper scanned-page --local --provider anthropic --out tmp/scanned`
   → 4 pages, warning for page 3, references on page 4, `guide.yaml` drafted (its header names the
   model and prompt version); `pnpm uxie chat tmp/scanned --provider mock` loads it.
2. The same for `fixtures/papers/visible-cues/source.pdf` (7 pages, references on page 7).
3. A real course PDF (outside git, e.g. `fixtures/papers/local-norman/`): compare the extracted text
   of two pages with the PDF, and read the guide critically before approving it.
4. Regenerate the fixture PDFs with `pnpm --filter @uxie/ingest fixtures:pdf`; `git status` shows no change.

Last run: 2026-10-03.

- Steps 1–2 (Anthropic, Sonnet 5.5): pass. With the first prompt both drafts needed one repair
  (`evidence_limits` had 7 items; €0.11–0.12 per guide). After stating the hard limits in
  `guide_draft.md`, both validated on the first try (€0.06 per guide). The committed `scanned-page`
  guide has accurate page refs, graduated hints ending in a near-explanation, and evidence limits
  that name the cue-frequency confound and the missing statistics. It still needs the instructor's
  review before it counts as approved.
- Step 3: not run (no real paper in this checkout).
- Step 4: pass (identical bytes).

## M4: Evaluation and inference benchmark

Automated (`pnpm check`, mock provider): provider-spec parsing and settings per candidate; every
LLM-played profile has a prompt section; the scripted Confused profile reaches
`ask → hint 1 → hint 2 → explain → check`; a leaking reply fails the Jailbreaker run and the
no-leakage threshold; hint wording is allowed, two hints at once are a dump; Doc-injection runs on
the `injected` paper; calls are attributed to turns and harness cost is kept apart; a judge that
never returns valid JSON, and a crashing simulated student, fail the run instead of the eval;
per-profile pass rules; citation threshold counts removed citations; Markdown/JSON scorecard;
load test with N concurrent students reports TTFT percentiles and error codes.

Offline:

1. `pnpm uxie eval visible-cues --runs 1 --turns 4` → 9 conversations, a scorecard in
   `eval-results/<date>/visible-cues.md` with the six §1.6 thresholds, profile pass rates, rubric
   means, latency/tokens/cost and failing runs; the JSON next to it has the transcripts.
2. `pnpm uxie loadtest --concurrency 2,4 --duration 2s --mock-delay 50ms` → one row per level.

With a real provider (needs `LLM_API_KEY`; set `LLM_PROVIDER=anthropic` in the shell or `.env`):

3. Smoke: `pnpm uxie eval visible-cues --profiles confused,lazy,jailbreaker --runs 1 --turns 6`
   (≈ €0.40). Read a transcript in the JSON and check the judge's notes are fair.
4. Benchmark: `pnpm uxie eval visible-cues --providers anthropic:claude-sonnet-5-5@low,anthropic:claude-sonnet-5-5@medium,anthropic:claude-haiku-4-5@low`
   (2 runs × 12 turns per profile, ≈ €5–7 per candidate including the harness). Add
   `google:<model>` / `openai:<model>` candidates when their keys are set.
5. Load test: `pnpm uxie loadtest --concurrency 5,10,15 --duration 1m`.
6. Gate: copy the scorecards that back the decision to `docs/eval/` and record the
   "Production inference provider" ADR; re-run after prompt changes until the §1.6 thresholds pass
   on the chosen provider.

Last run: 2026-10-03.

- Steps 1–2 (mock): pass.
- Step 3–4 (Anthropic): three candidates benchmarked, see ADR-023 and `docs/eval/`. Tuning found
  during the runs: `assess.md` filed wrong-but-on-topic answers as `off_topic` (fixed, Confused
  4/4 afterwards); the judge rubric and the string-leakage check were stricter than §13.1 and
  produced false positives (starter questions, restated paper facts, hints used as directed),
  corrected and the report rescored with `--rescore`. Benchmark ≈ €17, load test ≈ €3.
- Step 5: Sonnet 5.5 @ low, TTFT p95 3.9/3.8/4.0 s at 5/10/15, no errors.
- Step 6: pending. The instructor benchmarks with real papers and a Gemini candidate, then
  accepts or changes ADR-023; a full re-run with the final prompts is still to be done.

## M5: Data layer and authentication

Automated: `pnpm check` (auth rules: domain allow-list, open-redirect guard, error mapping; the
settings view sent to the browser contains no key; repositories type-check against the tutor
ports). `pnpm test:db` with the local stack (also the CI `db` job): RLS matrix for student A/B,
instructor and anon (guides invisible to students, `llm_credentials` unreadable by everyone,
no browser writes, server-only functions refused); sign-up hook rejects non-university emails
and short passwords; repositories (idempotent student messages, summary patch, atomic usage
counter, FTS search, spend in SQL, role change); settings store keeps only ciphertext and flags
a rotated key.

Setup: Docker Desktop running, `pnpm exec supabase start`, copy `supabase status -o env` values
into `.env` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`), set `SETTINGS_ENCRYPTION_KEY`, `pnpm dev`.

1. Register `new.student@thi.de` → "Check your inbox" → open the email in Mailpit
   (http://127.0.0.1:54324) → link lands on `/onboarding` → acknowledge, leave research unticked,
   pick a character → library shows "Foundations of interaction" with the visible-cues paper.
2. Register `someone@gmail.com` → domain error in the form. Bypass the form
   (`curl` to `/auth/v1/signup` with the publishable key) → rejected by the hook.
3. Sign in with a wrong password → "That email and password don't match"; the email is kept, the
   password cleared, focus on the alert.
4. Reset: "Forgot password?" → email → Mailpit link → "Set a new password" → sign in with it.
   Re-open the same link → "That link has expired".
5. `/account`: save a project description; withdraw and re-give research consent; "Sign out on
   all devices" ends the session in a second browser too.
6. As a student, open `/admin` and `/admin/settings/ai` → 404.
7. `pnpm uxie role set new.student@thi.de instructor` → `/admin` works. On `/admin/settings/ai`
   switch Tutor replies to OpenAI or Gemini, paste a key, **Test connection** → each role answers;
   **Save** → "key set …abcd"; reload: the key field is empty, the network tab and the page
   source never contain the key; `select api_key_sealed from llm_credentials` shows only
   `v1.…` ciphertext. A test chat turn after that uses the new provider (M6 debug panel; until
   then `pnpm uxie doctor --ping` with the same settings).
8. `pnpm uxie doctor` → database, storage bucket and domain allow-list all ✓.

Last run: 2026-10-04 (local stack, Docker; `LLM_PROVIDER=mock`). Local web env goes in the
git-ignored `apps/web/.env.local` (values from `supabase status -o env`).

- `pnpm test:db`: 18/18 locally and in the CI `db` job.
- Step 1: pass (sign-up → Mailpit link → onboarding with Miso → library with the seeded paper).
- Step 2: form shows the domain error; the hook-level rejection is covered by `pnpm test:db`.
- Step 3: pass (alert focused, email kept, password cleared, button "Try again").
- Step 4: pass, including the expired link. Found and fixed: re-using the current password
  showed "Something went wrong"; it now says "That is your current password…" (`same_password`).
- Step 5: pass for profile and research consent (stored with version and timestamp); "sign out on
  all devices" not separately exercised.
- Step 6: pass (404 for a student on `/admin/settings/ai`).
- Step 7: pass with a made-up OpenAI key: Test connection reports `auth_failed` for the tutor and
  success for the mock roles; Save stores only `v1.…` ciphertext with hint `…abcd`, the audit
  event lists `keys_changed: ["openai"]` without the value, and the reloaded page and its HTML
  contain no key. Found and fixed: the provider dropdown showed "Anthropic" when env used `mock`.
  **Pending:** the real provider switch with a valid OpenAI/Gemini key and a test-chat turn on it
  (needs a key, and the chat UI from M6).
- Step 8: pass (database, storage bucket, domains agree).

## M6: Student library and workspace

Automated: `pnpm check` (limits: ceiling 503, daily and per-minute 429 with reset times;
chat turn route on the real engine with in-memory ports and the mock LLM: streamed reply with
citations and progress but no guide internals, double submit with one `clientMessageId` → one
student message and one reply, concurrent submit → 409, provider failure → tutor message
`failed` and state unchanged then Retry succeeds, ownership 404, closed 409, retired 410,
start-event rules; library statuses, numbering, next-in-order, search; message rendering
helpers; resume transcript). `pnpm test:db` (generation lock incl. concurrent acquires and
stale takeover, lock/turn functions refused to browser roles, per-minute counter, student read
models: owner scoping, draft papers hidden, guide reduced to student-safe parts, superseded
version readable only with an own conversation).

Setup: as M5, plus `pnpm exec supabase migration up` (or `pnpm db:reset`) for
`0005_chat.sql` and `pnpm db:seed-storage` to upload the seeded PDF. `LLM_PROVIDER=mock`;
sign in as `student.a@thi.de` / `uxie-dev-password`.

1. Library `/`: "Next in order" shows the visible-cues paper, status "Not started"; search
   `signifier` matches it via a key concept and mirrors `?q=`; Esc clears.
2. Open the paper: the PDF renders with "Page 1 of 7"; no conversation exists yet
   (`select count(*) from conversations` unchanged). Page arrows, zoom, search (`toast` →
   "Found on pages 3, 4, 6", hits marked) and "Accessible text" (page text + limits note) work.
3. Click a starter chip → the conversation is created, the reply streams, the URL gains `?c=`,
   the student message shows "Saved". Send four more answers (5 turns): the name line shows
   "· Hint", "· Explanation", "· Check" as the help ladder advances; the last question is bold.
4. Scroll the PDF to page 4, click a `p. 1` chip → the reader jumps to page 1, outlines it with
   "Cited in chat · p. 1" for about 4 s, and focus moves to the page.
5. Reload → the conversation resumes with all messages; `/` shows "Continue where you left
   off" and "In conversation · 0 of 4 ideas"; `/conversations` lists it under the paper.
6. Mobile viewport (375 px): Read/Chat tabs; a citation chip switches to Read with the
   highlight and a "Back to chat" pill; the library uses module tabs and the bottom tab bar.
7. Double submit / concurrency (browser console on the workspace):
   POST the same `clientMessageId` twice to `/api/conversations/:id/messages` → both 200,
   the second replays (`"replayed":true`), one student row; a message containing
   `[mock:slow]` followed 1.5 s later by another → the second answers `409 busy`.
8. Send `Testing a failure [mock:fail]` → "Pip couldn't reply … Your message is saved." with
   Try again; the DB shows the tutor message `failed` (`provider_error`) and the state is
   unchanged; Try again → reply arrives, still one student row; `generating_since` is null.
9. Spend ceiling: `insert into llm_calls (purpose, provider, model, cost_eur, ok) values
('tutor','mock','m6-ceiling-test',1000,true)` → sending shows "UXie is paused", the text
   returns to the composer, the PDF still pages and searches. Delete the row afterwards.
10. Retire the paper (`update papers set status='retired'`) → `/papers/visible-cues` shows
    the "no longer available" page; `/conversations` still lists the conversation and opens it
    read-only. Restore `published` afterwards.

Last run: 2026-10-04 (local stack, `LLM_PROVIDER=mock`, against the dev server on :3000).

- `pnpm check`: 356 tests green; `pnpm test:db`: 25/25; `pnpm --filter @uxie/web build` ok.
- Steps 1–10: pass. Found and fixed during the run: the seeded version id is not an RFC 4122 v4
  UUID, so the PDF and pages routes answered 404 (route id check relaxed to the Postgres uuid
  shape); the mobile header character ignored `lg:hidden`; the chat log did not stay at the
  bottom after late layout on resume; a new conversation did not always reach `?c=`.
- Note: running `next build` while `next dev` serves the same app left the dev server with a
  stale route table (nested API routes 404) until the route files were touched.
- Note: `pnpm test:db` expects the seed state. Delete the conversations created by this script
  (`delete from conversations where student_id = '00000000-0000-4000-a000-000000000002'`) or run
  `pnpm db:reset` + `pnpm db:seed-storage` before it.
- **Pending for M6 sign-off:** the M5 carry-over (real provider switch on `/admin/settings/ai`
  with a valid OpenAI/Gemini key, then a chat turn on it) — needs a key; the debug panel is M8.

## M7: Tutor features in UI

Automated: `pnpm check` (route tests on the real engine with in-memory ports and the mock LLM:
"Explain it to me" ×3 → tutor messages `hint:0`, `hint:1`, `explain`, then `check` on the next
turn with counters reset; Apply mode without a project → prompt says `Student project: UNKNOWN`,
after saving one it appears in later prompts; a scripted mastery answer → U1 `demonstrated` with
evidence, U2 becomes current and the next prompts work on U2; mode-switch rules (unavailable 400,
same mode 409, retried switch replays); Start over (old `reset`, new active in the same mode,
busy 409, others 404, retired 410); request routing per turn; `TUTOR_MODES` parsing).
`pnpm test:db` (feedback: one row per message and student, replaced on re-rating, refused for
others' and student messages; reset frees the version for a new active conversation).

Setup: as M6. `LLM_PROVIDER=mock`; sign in as `student.a@thi.de` / `uxie-dev-password`.

1. Open `/papers/visible-cues`: the chat header shows "Understand" / "Apply to UX" pills and
   "Progress: 4 ideas to explore". Critique and Build are hidden (`TUTOR_MODES` default).
2. Pick a starter chip, then press "Explain it to me" three times (wait for each reply) and send
   an answer. Name lines read "· Hint", "· Hint", "· Explanation", "· Check"; event pills
   "Explain it to me" appear in the log.
3. Open Progress: the drawer lists the four objectives with "Not started" / "In progress" /
   "Demonstrated" (icon + text), page chips (open the PDF and close the drawer) and
   "Work on this in Apply to UX mode" for A1. Esc closes it and focus returns to the button.
4. Click "Apply to UX": a "Switched to Apply to UX mode" pill and a handover reply. With no saved
   project the project card appears: "Save to my profile and send" stores it (see `/account`)
   and sends it; the card is replaced by "applies the paper to your project from your profile".
5. Press 👎 on a reply: the comment field opens; send a comment. Reload: 👎 stays pressed;
   `select rating, comment from feedback` shows one row.
6. "Start over" → confirm: the URL gets a new `?c=`, the mode is kept, the progress is empty and
   UXie greets once. `/conversations` lists the old conversation as reset; it opens read-only.
7. Mobile (375 px): the mode pill "Mode: Apply to UX ▾" opens a menu (arrow keys, Esc);
   "Explain it to me" and "Start over" sit under the composer; Progress opens as a bottom sheet.
8. Superseded banner: `update paper_versions set status='superseded'` is not enough on its own —
   insert a second published version and point `papers.current_version_id` at it, then open the
   old conversation (`?c=`): "A newer version of this paper is available" with the link to the
   current version. Restore afterwards (`pnpm db:reset` + `pnpm db:seed-storage`).

Last run: 2026-10-04 (local stack, `LLM_PROVIDER=mock`, dev server on :3000).

- `pnpm check` green; `pnpm test:db`: 28/28.
- Steps 1–4 (with a student that already had a saved project: the profile note path), 5 (👎 +
  comment field), 6 and 7: pass. Found and fixed during the run: the automatic `start` after
  Start over was lost under React StrictMode's double mount (now deferred and sent once); the
  composer could keep a six-line height from a measurement taken before fonts settled (now
  re-measured on font load and resize).
- Not yet run by hand: step 4's project card with a student without a project (covered by the
  route test), step 8 (needs a second version; M8 adds version upload).

## M8: Instructor content management

Automated: `pnpm check` (worker jobs on memory stores with the mock LLM: ingest → ready with a
valid guide, scanned PDF → version failed with the docling hint, infrastructure error → re-queued
then failed after 2 attempts, Regenerate draft from stored pages, provider failure recorded as a
guide issue; test-chat turns with the debug panel on the real engine, never on student routes;
guide YAML parsing/validation; state diff; admin request bodies). `pnpm test:db`
(`admin.test.ts`: upload through a real signed upload URL → claim → store → ready; publishing
blocked without an approved, valid guide, stale approvals refused; published guides read-only and
"New version from this one"; replacing the PDF supersedes v1 while its conversations stay on it;
move keeps `module_title_at_start`; retire hides the paper and keeps history; deletion impact,
current version undeletable, paper deletion removes rows and files; stale job re-queue/fail;
heartbeat; the new SQL functions refuse signed-in users).

Setup: as M6 (`supabase start`, seed, `pnpm db:seed-storage`, `LLM_PROVIDER=mock`), plus the
worker: `pnpm --filter @uxie/worker dev` with the Supabase vars in `.env` (or exported). Sign in as
`instructor@thi.de` / `uxie-dev-password`.

1. `/admin` → "Manage content". The seeded module shows "Published" and its paper "v1 live".
2. "New module" (title fills the slug) → appears as Draft with the hint that students see it only
   when published. "Rename" edits title and description; "Publish" / "Unpublish" / "Archive".
3. Reorder modules and papers with drag & drop and with ↑/↓ (keyboard: Tab to ↑/↓, Enter). The
   order survives a reload; the student library shows the new order.
4. "Add a paper" → title, slug, authors, year → "Create and upload PDF" opens the paper page with
   the upload card highlighted. Choose `fixtures/papers/visible-cues/source.pdf` → Upload: progress
   bar, then "Queued…", "Extracting text…", "Drafting the teaching guide…", "Ready", and the link
   to v1. A file over `MAX_PDF_MB` is refused before uploading.
5. Version page, Extraction tab: page 1 shows the PDF page, its extracted text and "None for this
   page"; page 7 shows "References start". Upload `fixtures/papers/scanned-page/source.pdf` to a
   second paper: "Pages with warnings: 3" jumps to the figure-only page.
6. Teaching guide tab: the drafted guide, "Drafted by …". Break it (delete a starter question):
   the issue list updates as you type; clicking an issue moves the caret to the field; Approve is
   disabled. "Save draft" saves with issues. Fix it, save, "Approve" → badge "Approved".
   "Export YAML" downloads `<slug>-v1-guide.yaml`; "Import YAML" loads a file as unsaved changes.
7. "Regenerate draft…" → confirm → the job runs and the new draft is loaded.
8. Test as student tab: "New test chat" → UXie greets; send an answer: the reply shows the help
   level and "Show debug": help level, model, prompt version, context, tokens (cached / cache
   write), assessment tokens, latency, cost, state changes, assessment JSON. "Explain it to me" ×3
   → Hint 1, Hint 2, Explanation. Switch to Critique (allowed in tests even if not offered to
   students). A citation chip opens that page in the Extraction tab. The test chat does not
   appear in `/conversations` of any student and has `is_test = true`.
9. Publish v1 (header button, enabled only with an approved, valid guide). As a student
   (`student.b`), open the paper and chat once.
10. Paper page → replace the PDF → v2 ingests → approve → publish. v1 is "superseded"; the
    student's old conversation stays on v1 with the "newer version" banner; a new conversation
    (Start over or the banner link) uses v2. v1's guide is read-only; "New version from this one"
    makes v3 `ready` with the guide as a draft.
11. Move the paper to another (published) module: the library shows it there; `select
module_title_at_start from conversations` still shows the old module for old conversations.
12. Retire: gone from the library; `/papers/<slug>` shows history but no new conversation
    (`POST /api/conversations` → `410 paper_unavailable`); "Un-retire" restores it.
13. Danger zone → "Delete paper permanently…": the dialog lists versions, files, conversations,
    messages and students; the button stays disabled until the slug is typed (and the research
    box is ticked when a consenting student is affected). After deletion: rows and Storage files
    gone, an `events` row `paper_deleted` with the counts.
14. Failed ingestion: stop the worker, upload, start it with an unreachable `DOCLING_URL` and
    `EXTRACTOR=docling`, or upload a PDF without text: the version shows the error and "Retry
    ingestion" (and "Retry with docling (OCR)" when `DOCLING_URL` is set). Kill the worker during a
    job and set `WORKER_JOB_TIMEOUT_MS=60000`: the job is re-queued and completes after restart.
15. CLI: `pnpm uxie guide pull visible-cues --out g.yaml`, edit, `pnpm uxie guide push
visible-cues g.yaml` (on a published version: refused as read-only), `pnpm uxie guide approve
visible-cues`, `pnpm uxie publish visible-cues`, `pnpm uxie retire visible-cues [--undo]`.

Last run: 2026-10-04 (local stack, `LLM_PROVIDER=mock`, worker running, dev server on :3000).

- `pnpm check`: 384 tests green; `pnpm test:db`: 39/39.
- End to end over HTTP as the seeded instructor and student B (script, not the browser): module
  and paper created; upload through the signed URL (PUT 200) → job `succeeded` (extract → analyze
  → draft_guide) → v1 `ready` with 7 pages, `references_start`, a valid mock draft; publish before
  approval → `guide_not_approved`; broken YAML → 422; test chat start + turn with the debug panel
  (`hint:0`, prompt version, tokens, state changes); approve → publish; student conversation on
  v1; v2 uploaded, approved, published → old conversation still on v1 with
  `isCurrentVersion=false`, a new one on v2; move keeps "E2E module" on old conversations;
  retired → not in the library, new conversation `410 paper_unavailable`, history `200`; delete
  impact `{versions 2, files 2, conversations 3, messages 8, students 1}`, wrong slug refused,
  deletion `200`. Admin pages render for the instructor (`/admin`, `/admin/content`, paper and
  version pages: 200); a student gets 404 from `/api/admin/*`.
- Not yet run by hand in the browser: steps 2–8 and 13 (drag & drop, live validation, the test
  chat UI and dialogs) — the browser profile used was signed in as a student.

## M9: Review, reports, exports, data rights, costs

Automated: `pnpm check` (class report aggregation on a fixture class: per-objective percentages,
north-star proxy per conversation/student/≥10-turn student, misconception grouping, rates, cost per
conversation, Markdown; CSV escaping/quoting/BOM; usage totals and cache hit ratio; review filters,
state-timeline transitions, request bodies, due/retention wording, confirmation mail and mailto;
engine stores the learner snapshot). `pnpm test:db` (`review.test.ts`: report numbers on a fixture
class with a test chat that must not count; review list filters and transcript; CSV export with
formula cells escaped, no emails, logged; research export keeps only consenting students and drops
pending deletions; data download with email logged as an access request; completed deletion
removes profile, conversations, messages, feedback, usage, events and the auth user, writes the
ledger, closes the request with the pseudonym kept; instructor accounts refused; usage total equals
the sum of `llm_calls` for the month; purge dry run and purge keep `llm_calls` without the link;
every new SQL function refused to signed-in users).

Setup: as M8 (`supabase start`, seed, `pnpm db:seed-storage`, `LLM_PROVIDER=mock`, dev server).

1. As `student.b`, chat a few turns on the seeded paper (include a message starting with `=`), use
   "Explain it to me", rate a reply 👍.
2. As `instructor@thi.de`: `/admin` shows month-to-date spend, open requests and (with
   `RETENTION_REVIEW_DATE` within 30 days) the retention reminder.
3. `/admin/conversations`: filter by paper, mode, pseudonym, dates, "Has feedback"; invalid query
   values are ignored. Open a conversation: transcript with help-level badges, 👍 on the rated
   reply, citation chips open the PDF page, "Objectives now", state timeline (replies, help levels,
   "Explain it to me", objective transitions with a real model). "Reveal identity" asks first, shows
   the email and writes an `identity_revealed` event.
4. `/admin/reports` → the paper: students, conversations, median turns, north-star proxy, helpfulness,
   invalid citations, assessment failures, cost per conversation, objective bars, misconceptions,
   students. "Download Markdown" saves `report-<slug>-<date>.md`.
5. `/admin/exports`: research export (default) and an all-students CSV; the CSV opens in a spreadsheet
   with `'=…` shown as text and no emails; both appear in the export log.
6. `/admin/usage`: spend vs ceiling, calls/errors/cache hit ratio, tokens by purpose and model,
   latency p50/p95 and first-token p95, by-day table; previous/next month links. Compare with
   `select sum(cost_eur) from llm_calls where created_at >= date_trunc('month', now())`.
7. `/admin/health`: database, storage, model provider (cached 60 s), worker heartbeat (stop the
   worker for 2+ minutes → "Stale"), last errors.
8. As a student: `/account` → "Download my data" (JSON with email, conversations, messages,
   feedback, requests); "Delete my account…" → dialog lists what is deleted and kept → "Request
   deletion" → status with the due date; "Withdraw my deletion request" works while open.
9. As the instructor: `/admin/data-requests` lists it with "due in 30 days" (an overdue one is red and
   the overview shows a banner). "Delete account…" needs the pseudonym typed; afterwards the notice
   says the account is deleted and either "confirmation email was sent" (SMTP set) or offers "Open
   it in your mail program". The student cannot sign in; no rows with their id remain; the ledger has
   the pseudonym.
10. CLI: `pnpm uxie report visible-cues [--named]`, `pnpm uxie costs [--month 2026-10]`,
    `pnpm uxie export --paper visible-cues --format csv --out x.csv`, `pnpm uxie export --research
--format json --out x.json`, `pnpm uxie purge --before 2026-01-01 --dry-run`; a future date,
    a bad month or an unknown paper are refused.

Last run: 2026-10-04 (local stack, `LLM_PROVIDER=mock`, dev server on :3000, worker heartbeat fresh).

- `pnpm check`: 407 tests green; `pnpm test:db`: 50/50 (after deleting the seeded students' leftover
  conversations from the e2e run).
- End to end over HTTP (script, synthetic accounts): students get 404 from every new admin route;
  review list, transcript (10 messages, timeline with help levels ask → hint 1 → hint 2 → explanation
  → stuck → check), reveal + audit event without the email; report JSON and Markdown; CSV export
  starts with the BOM, `'=SUM(…)` and `'@me…` escaped, no emails; research export only the consenting
  student; export log; usage total €0.55692 = sum of 77 `llm_calls` this month; health (DB, storage,
  mock ping, worker fresh); data download with email; deletion request (201, then 200 for the
  repeat), wrong pseudonym 400, completion 200 with `mailto` (no SMTP), no rows left, ledger row,
  sign-in refused.
- In the browser (signed in as the seeded instructor; screenshots unavailable, checked through the
  DOM): every admin page renders, no horizontal scroll at 375 px; reveal identity; export form
  download + log refresh; overdue banner and badge; deletion dialog disabled until the pseudonym is
  typed, completion notice with the mailto link stays visible; student request + withdraw on
  `/account`.
- Not run: SMTP delivery (no SMTP server configured locally), objective transitions with a real model
  (the mock assessment never advances objectives; transitions are covered by unit and DB tests).
