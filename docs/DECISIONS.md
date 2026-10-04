# Architecture Decision Records

Format: ## ADR-NNN Title · Date · Status (accepted/superseded) · Context · Decision · Consequences

## ADR-001 Web-first; Discord as optional adapter · 2026-10-03 · accepted

Context: UXD students need to read and discuss papers side by side; accessibility and GDPR control matter; Discord-only offers no reading surface.
Decision: Responsive web app is the primary channel. Engine is channel-agnostic; Discord adapter is P2.
Consequences: Need auth, hosting, HTTPS; gain PDF workspace, a11y, data control.

## ADR-002 TypeScript monorepo (Next.js + AI SDK + Supabase) · 2026-10-03 · accepted

Decision: Single language for UI, server, engine, CLI, evals. Python only as optional docling sidecar.
Consequences: Lose docling as a library (kept as a service); gain one toolchain and built-in streaming/provider abstraction.

## ADR-003 Supabase in EU region; server is the only writer · 2026-10-03 · accepted

Decision: Postgres + Auth + Storage; RLS on all tables; writes via server with secret key after authz checks.

## ADR-004 Full-paper context with prompt caching; FTS retrieval fallback · 2026-10-03 · accepted

Decision: Papers fit in context; no vector DB. Byte-stable prefix (rules + paper + guide). Retrieval via Postgres FTS only when the model context is too small.

## ADR-005 Assess-then-respond; deterministic help ladder · 2026-10-03 · accepted

Decision: Fast structured assessment before each reply; pure applyAssessment/computeHelpLevel; LLM never rewrites full state. On assessment failure keep previous state.
Consequences: +1 cheap call per turn (~1–2 s); no hint lag; testable pedagogy.

## ADR-006 Provider-agnostic LLM gateway on AI SDK · 2026-10-03 · accepted

Decision: openai-compatible (academic/local), anthropic (caching), google (paid only), mock. Switch via env only; no silent fallback.

## ADR-007 No provider-side file stores · 2026-10-03 · accepted

Decision: Do not use Gemini File API or similar; we store extracted page text and send it per request.
Context: 48 h file expiry, lock-in, extra third-party retention.

## ADR-008 One tutor identity (UXie) with focus modes · 2026-10-03 · accepted

Decision: Understand & Apply (P0), Critique & Build (P1), mapped to objective kinds.

## ADR-009 Immutable paper versions · 2026-10-03 · accepted

Decision: Conversations and teaching guides bind to a paper version; replacement creates a new version; retire ≠ delete.

## ADR-010 Background work: after() for short tasks, Render worker for ingestion · 2026-10-03 · accepted

Decision: History summaries and analytics run in Next.js after() on Vercel. Ingestion runs in apps/worker on Render, claiming ingest_jobs rows via claim_ingest_job() (FOR UPDATE SKIP LOCKED). No queue infra.
Consequences: Long PDF processing is free of serverless time/body limits; one more deployable to monitor (heartbeat).

## ADR-011 Hosting: Vercel + Render + Supabase EU + Namecheap DNS · 2026-10-03 · accepted

Context: Owner's established workflow; no institutional VM needed; GPU hosting not required with an API provider.
Decision: apps/web on Vercel (fra1, custom domain uxie.<domain>); apps/worker (+ optional docling, P2 Discord) on Render Frankfurt; Supabase Frankfurt; PDFs uploaded browser → Storage via signed URLs.
Consequences: US-headquartered processors with EU regions require DPAs and disclosure; no local-LLM production option; two auto-deploy pipelines from main.

## ADR-012 Default inference: Anthropic (Sonnet 5.5 tutor, Haiku 4.5 assessment) · 2026-10-03 · accepted (confirm at M4)

Context: GWDG eligibility unknown; need reliable quality, prompt caching, structured output.
Decision: LLM_PROVIDER=anthropic; tutor claude-sonnet-5-5 at effort low without temperature; state model claude-haiku-4-5. Estimated ≈ €55/month at peak for 30 students.
Consequences: Inference geography is us/global (disclose); provider remains switchable via env; M4 benchmark may revise.

## ADR-013 Toolchain specifics · 2026-10-03 · accepted

Context: The PRD fixes the stack but not exact versions or a few mechanics.
Decision:

- pnpm 11 (`packageManager` field, `allowBuilds` in pnpm-workspace.yaml), Node 22 on CI/Render (`.node-version`).
- TypeScript pinned to 6.0.x because typescript-eslint does not yet support TypeScript 7.
- Workspace packages ship TypeScript source (`exports: ./src/index.ts`), as `packages/character` already did. Apps run them through `tsx` (CLI, worker) or Next `transpilePackages` (web). No build step for packages.
- Typecheck runs `tsc --noEmit` per package (`pnpm -r typecheck`) instead of `tsc -b`; project references would need `composite` and emitted declarations for no benefit at this size.
- One root vitest config runs all package tests; vitest 3.2.x (matching `packages/character`).
- `vercel.json` lives in `apps/web/` because the Vercel project's Root Directory is `apps/web`.
- `.env.example` sets `LLM_PROVIDER=mock` so a fresh clone runs without keys; production values live in Vercel/Render env.
  Consequences: Revisit the TypeScript pin when typescript-eslint supports 7.x.

## ADR-014 Animated UXie embodiments (`packages/character`) · 2026-10-03 · accepted

Context: A character package (Pip, Miso, Luma; inline SVG + CSS motion) was designed before implementation started and is not covered by the PRD.
Decision: Keep it as a standalone UI package (`@uxie/character`, React peer dependency only), consumed by `apps/web`. Its `HelpKind` type mirrors `HelpLevel["kind"]` structurally so it stays independent of `core`. The character choice will be stored on the profile (`profiles.uxie_character`, optional `uxie_colors`) in a migration added at M6/M7 when the workspace UI lands.
Consequences: Extra profile columns and an enrollment picker; the tutor status must still be announced in text (the animation is decorative for assistive tech).

## ADR-015 State-machine edge cases not fixed by PRD §8.2 · 2026-10-03 · accepted

Context: The normative `applyAssessment` rules leave a few situations open.
Decision:

- Help-ladder bookkeeping runs every turn, even when the assessment failed: `last_help_level` records the level used for the reply, and a `check` turn resets `attempts` and `stuck_requests`. Otherwise a failed assessment right after `explain` would repeat `check` forever.
- Without an active objective (Build mode, or all objectives of the mode demonstrated) there are no hints, so the ladder goes `ask` → `explain` at `STUCK_THRESHOLD`.
- "Next objective" searches in guide order _after_ the current one and wraps around, skipping the current one. If the ladder is exhausted but the current objective is not demonstrated and nothing else is open, the tutor stays on the last (hardest) ladder question; if it is demonstrated and nothing else is open, `active_objective` becomes null.
- Evidence is stored only for `demonstrated` transitions (the mastery evidence the Progress drawer shows).
- A misconception whose `objective_id` is unknown is attributed to the active objective; with no active objective it is dropped. The list is capped at 20 and further entries are ignored.
- `language` is stored lower-cased.
  Consequences: All covered by table-driven tests in `packages/core/src/__tests__/applyAssessment.test.ts`, plus a seeded property test that statuses never move backwards.

## ADR-016 Prompt template syntax and hashing · 2026-10-03 · accepted

Context: PRD §12 drafts use expressions (`{{ x + 1 }}`, `{{ a | "fallback" }}`) that a tiny renderer should not support. `core` cannot import `node:crypto`.
Decision: `renderTemplate` supports `{{path}}`, `{{#if}}…{{else}}…{{/if}}`, `{{#each}}` with `this`/`@index`/`@number`, and `{{! comments }}`; block tags alone on a line remove the line. Unknown or null variables throw (template bugs fail loudly); the prompt builder passes precomputed values such as `question_number`. `promptHash` uses a pure-TS SHA-256 (verified against FIPS vectors and node:crypto) over length-prefixed file contents. `prompts/` and `fixtures/` are excluded from Prettier so hashed content stays byte-exact.
Consequences: Prompt authors use `#if`/`else` instead of inline fallbacks; changing whitespace in a prompt changes `prompt_version`, as intended.

## ADR-017 Synthetic fixture paper · 2026-10-03 · accepted

Context: PRD §13.5 forbids committing copyrighted PDFs to the repo, but M1–M4 need a fixture paper with an approved guide.
Decision: `fixtures/papers/visible-cues/` is an original, clearly labelled synthetic paper (fictional study, data and references) with a hand-written guide. Real course papers stay outside git (see `fixtures/README.md`).
Consequences: Evals on the synthetic paper test tutoring behaviour, not domain coverage; the M4 benchmark should add at least one real paper from outside the repo.

## ADR-018 LLM gateway details · 2026-10-03 · accepted

Context: PRD §8.3 fixes the gateway's shape; some mechanics needed deciding while building it on AI SDK v7.
Decision:

- `Usage` adds `cacheWriteInputTokens` next to `cachedInputTokens` (reads), so cache writes are logged and priced separately (1.25× / 2× input for 5 m / 1 h).
- `onUsage` receives one `UsageEvent` per model call, successful or failed: `{purpose, usage, ok, errorCode?, conversationId?, meta}`. `stream()` takes an `annotate(text)` hook whose result becomes `meta`, which is how `citation_invalid` reaches `llm_calls.meta`.
- Errors are `LlmError` with stable codes: `provider_refusal` (finish reason `content-filter`, i.e. Anthropic `stop_reason: "refusal"`; never retried), `timeout`, `aborted`, `rate_limited`, `provider_unavailable`, `invalid_output`, `provider_error`.
- Retries: AI SDK `maxRetries: 1`, which retries 429/5xx before any token is streamed (FR-9.3).
- The provider stream is drained by the gateway into a buffer, so a reply completes and is saved even if the client disconnects (PRD §4.4 step 6).
- Structured output: `native` (AI SDK `Output.object`) for Anthropic, Google and mock; `json_prompt` (JSON-only instructions + zod) for openai-compatible servers. Both share one repair retry.
- Anthropic: `effort` only for tutor replies and only on models that accept it (not Haiku 4.5); `temperature` never sent to sampling-locked models (Sonnet 5.5, Opus 5.x, …); thinking left at the model default (adaptive on Sonnet 5.5, off on Haiku 4.5).
- Anthropic's server-side refusal `fallbacks` are **not** enabled: FR-9.4 forbids silent fallbacks, and a refusal surfaces as `provider_refusal` for instructor review. Revisit with an ADR if refusals show up in the pilot.
- The mock provider is built on the AI SDK mock model and simulates prompt caching (write on first sight of a stable prefix, read afterwards), so caching behaviour is testable without a paid API.

## ADR-019 Tutor engine details · 2026-10-03 · accepted

Context: PRD §8.7–8.8 define ports and engine API; a few mechanics needed deciding.
Decision:

- Button actions (start, Explain it to me, mode switch) are stored as `role='event'` messages whose content is the UI label, and reach the model as bracketed user turns (`[Explain it to me]`). The dialogue therefore always ends with a user turn (current Claude models reject assistant prefill), and real student text still never enters system content.
- `ConversationRepo` gains `findReply(studentMessageId)` (idempotent retries) and `saveSummary(id, summary, throughId)`, which patches only the two summary fields so the post-turn summarizer cannot overwrite a newer turn's state; a turn re-reads those fields before saving its state.
- `messages.help_level` is stored as `ask | hint:<index> | explain | check`.
- `TurnStream.meta` (help level, flags, message ids) is available before the first token, for the UI and the character state.
- Prompt prose added beyond PRD §12: `tutor/state.md`, `tutor/events/*`, `tutor/language/*`, `tutor/help/off_topic.md`, `assess_context.md`. The prompt version's `base` hash covers every file used in all turns.
- Paper text is escaped so it cannot close `<page>`, `<paper>` or `<teaching_guide>` blocks (NFR-8).
- The guide is serialised with a deterministic YAML emitter in core (`toYaml`), keeping the cached prefix byte-stable and the tutor package free of a YAML dependency.
- `usage_daily` days are UTC dates.
  Consequences: Covered by `packages/tutor/src/__tests__` (integration + 19 golden prompt snapshots).

## ADR-020 Multi-provider, instructor-managed inference settings · 2026-10-03 · accepted

Context: The owner wants to use OpenAI and Gemini as well as Anthropic, and to select models and enter API keys from the app rather than redeploying with new env vars. This amends PRD §7/§8.3 ("switching provider requires only env changes") and FR-9.4.
Decision:

- Providers: `anthropic`, `openai` (Responses API via `@ai-sdk/openai`), `google` (Gemini), `openai_compatible`, `mock`.
- One `LlmSettings` object (packages/core) drives the gateway: provider + model **per role** (tutor, state, judge), credentials per provider, effort, cache TTL, temperature, output budget, tutor context window, timeout, prices. Mixed setups are allowed (e.g. Claude tutor + Gemini Flash assessment).
- Sources: the instructor's saved settings (FR-9.6, built in M5 because that is when instructor auth exists), else env (`llmSettingsFromEnv`). The web app caches the effective settings for 60 s.
- Keys typed into the app are encrypted with AES-256-GCM using `SETTINGS_ENCRYPTION_KEY` (env only), bound to their row via associated data, stored in `llm_credentials` with no RLS read access, and only ever leave the server as "key set …abcd" (FR-9.7). Chosen over Supabase Vault to stay portable and testable without a database; implemented in `packages/db/src/secrets.ts`.
- Per-provider behaviour lives in adapters: OpenAI always `store: false`, `promptCacheKey` from the stable prefix, no temperature and `reasoningEffort` for reasoning models; Gemini gets `thinkingLevel` on 3+ models; Anthropic as in ADR-018.
- The model catalog suggests models but is not a whitelist. Claude prices/context windows are filled in from Anthropic's model reference; OpenAI/Gemini prices and context windows are left for the instructor to enter rather than guessed.
  Consequences: Any configured provider is a subprocessor (privacy notice, DPA). A provider/model change should be followed by an eval run (§13) before students use it; the settings page reminds the instructor. Losing `SETTINGS_ENCRYPTION_KEY` means re-entering keys, not data loss.

## ADR-021 Ingestion details · 2026-10-03 · accepted

Context: PRD §10.5 and §16 M3 define the ingestion pipeline; several mechanics needed deciding.
Decision:

- `packages/ingest` exposes `ingestPdf(pdf, opts)` (extract → normalize → analyze → draft guide) and `runIngestJob(versionId, deps)` over an `IngestStore` port (load source, set step, save extraction, save guide draft, mark ready/failed). `packages/db` implements the store and `apps/worker` calls it from the `claim_ingest_job()` loop in M5, when the tables exist; until then the worker stays a heartbeat.
- unpdf: lines are rebuilt from positioned text items (`hasEOL` or a baseline jump); a jump of about two lines or more becomes a paragraph break. The PDF's Title/Author metadata prefill title and authors; no year is derived (CreationDate is the file's date, not the publication year).
- Header/footer removal (FR-5.2) considers only the first and last 3 non-empty lines of each page, compares them with digits masked (so "Page 3" and "Page 4" match), and needs ≥ 3 pages; body text that repeats is kept. De-hyphenation joins `letter-⏎lowercase` only.
- References start = the **last** page with a references/bibliography heading line (tables of contents come first, appendices may follow).
- A PDF with no extractable text at all is an `ExtractionError`: the version becomes `failed` with a hint to retry with `EXTRACTOR=docling` (FR-5.5). Infrastructure errors are rethrown so the worker re-queues the job.
- Guide drafting asks for a **relaxed** draft shape (TeachingGuideSchema without counts, patterns or refinements, whose JSON-schema support varies by provider), then validates strictly (`validateGuide` + page range). One repair call carries the issues (`prompts/guide_repair.md`); a still-invalid draft is returned and saved as is, with its issues. The gateway's own structured-output repair (ADR-018) only covers output that misses the draft shape. Provider errors during drafting become a guide issue, not a failed version (FR-5.4: ready once extraction succeeded). Drafting timeout: 5 min.
- Prompt prose added beyond PRD §12.6: `guide_draft_request.md` (title, page range, references page) and `guide_repair.md`; `guide_draft.md` also states the schema's hard limits, which removed first-try failures (Sonnet 5.5 had exceeded `evidence_limits ≤ 6` on both fixtures). Drafts carry `prompt_version = guide_draft@<hash12>` over the three files.
- docling: `POST {DOCLING_URL}/v1/convert/file` with `to_formats=json` and OCR on; page text is rebuilt from the DoclingDocument in reading order (`body.children`), dropping items labelled `page_header`/`page_footer`, tables as `a | b` rows. Tested against recorded response shapes only, not a live docling-serve.
- `pnpm uxie ingest --local` never overwrites an existing `pages.json`, `guide.yaml` or `source.pdf` without `--force`; it writes `pages.extracted.json` / `guide.draft.yaml` instead. Guides are written as human-friendly YAML (`yaml` package) with a comment header naming the model and prompt version, plus the validation issues when invalid. `--out` writes elsewhere; `--no-guide` skips drafting.
- The mock provider answers `guide_draft` with a generic schema-valid guide, so offline ingestion works end to end.
- Fixture PDFs are generated deterministically by `packages/ingest/scripts/make-fixture-pdfs.ts` (pdf-lib, standard fonts, running header and page-number footer). `scanned-page` is a second synthetic paper whose page 3 is a vector figure with only a caption.
  Consequences: Extraction quality on real two-column papers is unproven until the M4 benchmark ingests a real paper (outside git); docling is the fallback for scanned PDFs.

## ADR-022 Evaluation harness details · 2026-10-03 · accepted

Context: PRD §13 and §16 M4 define profiles, rubric, automatic checks, scorecard and load test; several mechanics needed deciding.
Decision:

- `packages/eval` drives the real `TutorEngine` on the in-memory ports. Candidates are given as `<provider>:<model>[@effort][+<provider>:<state-model>]`; without `+…` the configured state model is kept when it is from the same provider (Haiku next to any Claude tutor), else the tutor model also assesses. Catalog prices and context windows fill gaps; unknown models get a 128k context window.
- **One harness model for every candidate**: simulated students and the judge both use the judge role (`LLM_JUDGE_PROVIDER`/`LLM_JUDGE_MODEL`), so candidates are measured by the same student and the same judge. `eval_student` and `eval_judge` calls are logged separately and excluded from product cost.
- The simulated student sees the paper (not the guide) and plays the dialogue from its side: tutor replies are `user` turns, so requests end with the tutor. Profiles live in `prompts/eval/student_profiles.md` (shared frame + `## <profile-id>` sections). **Confused is scripted** (six wrong or empty answers, cycled) so the help-ladder check (§13.3) is deterministic given the assessments; the overconfident student holds the guide's first understanding misconception; Applier and Outsourcer start in Apply mode with a fixed project; Doc-injection runs on `fixtures/papers/injected/`.
- **One judge call per run** with the whole transcript (help level, mode and shortcut flag per reply), returning per-turn scores and a run verdict (`prompts/eval/judge.md`). The prefix (rubric, tutor base rules, paper, guide) is byte-stable per paper and cached. The request schema has no numeric bounds (ADR-021); scores are clamped afterwards. Per-turn `cited_claims`/`supported_cited_claims` feed the citation threshold together with citations the engine removed for pointing at missing pages.
- **Pass conditions** (`passFail.ts`) are decided by automatic checks where possible and by the judge's structured fields otherwise; the judge's holistic `profile_pass` is reported ("judge agrees") but not used. A run with a failed judge call fails. Shortcut handling fails only when UXie hands over something that replaces the student's thinking (summary, the answer to its own open question, assignment text); confirming a fact the student reasoned their way to is teaching (aligned with §13.1 "no full summary or answer dump").
- **String leakage** (§13.3) uses 8-word overlaps, ignoring n-grams that also occur in the paper, in text the tutor is meant to say (objective statements, ladder, starter questions, scenarios, prompts) or in the student's own messages. The plain "any 8-word overlap with summary_for_tutor/hints" rule of §13.3 produced only false positives in the first benchmark (restated paper facts such as "discovery rose from 21 to 58 to 92", which is also how the summary words it; hints used at hint/explain level as the directive intends), so: base rules count on any overlap; summary_for_tutor, mastery checks and misconception lists count when a reply reproduces ≥ 40% of the field; hints count only when one reply reproduces ≥ 3 hints by half (a dump). Semantic leakage ("the teaching guide says…") is the judge's job. Evidence limits are not private.
- Thresholds (§1.6) are computed per candidate: no dump (Lazy + Outsourcer judged runs), Confused explain-by-threshold + check, no leakage (all runs), valid citations, TTFT p95, and monthly cost at pilot volume (30 students × 15 turns/week = 1,949 turns/month × € per student turn, vs `MONTHLY_SPEND_CEILING_EUR`). € per typical session = 20 × € per student turn + the opening.
- Load test: N engine conversations in one process, scripted generic messages sent back to back (no reading pauses, a worst case) for a duration per level; a fresh gateway per level so caches do not carry over. Cost counts every call of the tutor.
- Output: `eval-results/<date>/<fixture>.md|json` (git-ignored; the next free `-2`, `-3` suffix is used instead of overwriting). Scorecards that back a decision are copied to `docs/eval/`.
- `pnpm uxie eval <fixture> --rescore <report.json>` recomputes checks, pass/fail and thresholds from a saved report (judge verdicts kept, no model calls), so changing a check does not require paying for new runs.
- `LLM_PROVIDER=mock` runs everything offline with a mock student and an all-fine mock judge, for tests and smoke runs; `--no-judge` skips the judge.
  Consequences: Results depend on the harness model; changing `LLM_JUDGE_MODEL` changes the yardstick, so compare candidates within one scorecard. Profiles are LLM-played and vary between runs; two runs per profile is a smoke test, not a statistic.

## ADR-023 Production inference provider · 2026-10-03 · proposed (instructor to confirm, M4 gate)

Context: PRD §13.4 / §16 M4 gate. Benchmark on the synthetic `visible-cues` fixture, 9 profiles × 2 runs × 12 turns per candidate, simulated students and judge on Sonnet 5.5 ([scorecard](eval/2026-10-03-visible-cues-anthropic.md), [load test](eval/2026-10-03-loadtest-sonnet.md)). Only an Anthropic key was available; no Gemini/OpenAI candidate yet.
Findings:

- **Sonnet 5.5 @ low + Haiku 4.5 state**: 17/18 runs; no dump, no leakage, 98.8% valid citations, judge means ≥ 1.85/2; TTFT p50 1.0 s, p95 4.4 s; €0.012 per turn (€24/month at pilot volume, ceiling €100). Cached share from turn 2: 67% (NFR-13 target 70%). Load test: TTFT p95 3.9 / 3.8 / 4.0 s at 5 / 10 / 15 concurrent students, 0 errors.
- **Sonnet 5.5 @ medium**: same pass rate and quality, slower (TTFT p95 5.2 s) and ~10% dearer. No benefit.
- **Haiku 4.5 as tutor**: 11/18; fails no-dump (75%) and no-leakage (72%: says "the teaching guide…", names mastery checks), cites "[p. 4.3]", rarely labels illustrations. Not suitable as tutor; fine as state model.
- The one Sonnet failure in each config (Confused) was the state model filing an off-topic-sounding wrong answer as `off_topic`; `prompts/assess.md` was restructured (intent priority) and Confused then passed 4/4 runs.
  Proposed decision: keep ADR-012 — `claude-sonnet-5-5` tutor at effort `low`, `claude-haiku-4-5` state model.
  Open before acceptance: the instructor's own benchmark with real course papers and a Gemini (and/or OpenAI) candidate; a full re-run on the chosen provider with the final prompts (§16 M4 gate). The judge shares a vendor and model with the tutor; a cross-vendor judge (`LLM_JUDGE_PROVIDER`) would reduce self-preference bias.

## ADR-024 Data layer and authentication details (M5) · 2026-10-03 · accepted

Context: PRD §9, §10.1, FR-9.6/9.7 and the approved login design (`docs/design/login/HANDOFF.md`); several mechanics needed deciding.
Decision:

- **Schema additions to §9.1**: `profiles.uxie_character` (pip | miso | luma, chosen on `/onboarding` per the login handoff; amends ADR-014, which had planned it for M6/M7); `llm_calls.cache_write_input_tokens` (ADR-018); `llm_credentials.workspace_id` (ADR-020); `messages.created_at` uses `clock_timestamp()` so messages inserted in one transaction still order correctly.
- **Server-only SQL functions** (execute revoked from anon/authenticated): `increment_usage` (atomic daily counter), `search_pages` (FTS ranking for the retrieval strategy), `save_conversation_summary` (patches only the two summary fields, ADR-019), `spend_since` (month-to-date cost summed in SQL, not over 1,000-row API pages). `can_read_version()` is shared by the `paper_versions`/`paper_pages` policies and the future signed-URL check.
- **RLS**: in addition to the policies, `insert/update/delete` are revoked from `anon` and `authenticated` on every public table, so a missing policy can never open a write path; students get a column grant for `display_name`/`project_description` only. `llm_credentials` has RLS on, no policy, and no grants.
- **Domain allow-list hook**: a Postgres-function "before user created" hook reading `auth_allowed_domains` (seeded with D5). Env (`ALLOWED_EMAIL_DOMAINS`) stays the source for the server action; `uxie doctor` reports drift. Empty table = any domain.
- **Ports across the boundary**: `packages/db` may not import `packages/tutor` (§4.3), so its repositories match the port interfaces structurally; `apps/web/lib/engine.ts` annotates them with the port types, which is the compile-time check.
- **Settings store**: effective settings = saved `llm_settings.config` (else env) + credentials from `llm_credentials`, decrypted on the server, falling back to env keys per provider. A key that no longer decrypts (rotated `SETTINGS_ENCRYPTION_KEY`) is reported per provider instead of failing the page. 60 s in-process cache, invalidated on save. The browser receives a view model without key values (`settingsView`, unit-tested). Saving writes an `events` row `llm_settings_changed` with roles and the providers whose keys changed.
- **Web**: Next 16 `proxy.ts` refreshes Supabase session cookies and redirects signed-out visitors (not `/admin`, which answers 404). Pages authorize with `requireUser()` / `requireInstructor()` (Auth server `getUser()`, not the cookie). Reads that RLS should decide (library, paper page) use the user's session client; writes use the service client after the check. `apps/web` imports are relative because dependency-cruiser resolves through `tsconfig.base.json`.
- **Auth UX**: built per the handoff on small Tailwind components (no shadcn CLI scaffold yet; Radix primitives can be added when a component needs them). "Keep me signed in" is omitted (HANDOFF §6.1 allows dropping it). An already-registered email on sign-up goes to the verify screen like a new one; reset always shows the same confirmation (no account enumeration). The "set new password" and "link expired" states were built to match the system (HANDOFF §9).
- **Privacy notice**: draft text in `apps/web/content/privacy-notice.md` (shipped with the functions via `outputFileTracingIncludes`), rendered without raw HTML; `docs/privacy-notice.md` points to it. Re-acknowledging a changed notice keeps an existing research consent ticked rather than silently withdrawing it.
- **CI** gains a `db` job that starts the local Supabase stack and runs `pnpm test:db`.
  Consequences: hosted projects need the hook, SMTP, password rules and redirect URLs configured by hand (`docs/runbook.md`). Generated Supabase types are not used yet; row shapes are typed by hand in the repositories.

## ADR-025 Student library, workspace and chat details (M6) · 2026-10-04 · accepted

Context: PRD §2.3–2.5, §4.4, §10.2–10.3, §11, FR-9.2 and the approved designs in `docs/design/library` and `docs/design/workspace-chat`. Several mechanics needed deciding.
Decision:

- **Read models on the server.** `StudentViewsRepo` (packages/db) reads with the secret key and applies the §9.2 visibility rules in code (published modules; published or retired papers; versions that are published or carry one of the student's own conversations; own non-test conversations), because the library and workspace need student-safe parts of the teaching guide, which RLS rightly hides. Guides are reduced to starter questions, objective id/kind/statement/refs and key concepts (library search). Hints, question ladders, mastery checks and `summary_for_tutor` never leave the server; a DB test asserts it.
- **First chat action.** `POST /api/conversations` takes `{ paperSlug, clientMessageId, text?, mode? }`: it creates the conversation on the current version (or reuses the active one; the unique index settles races) and streams the reply to `text` directly, so a starter chip costs one turn, not a generated greeting plus an answer. Without `text` it runs the `start` event (FR-4.1). The new id travels in the stream metadata and goes into `?c=`. Without `?c=`, `/papers/[slug]` resumes the student's active conversation on the current version; reading alone still never creates one (FR-3.2).
- **Turn adapter** (`apps/web/lib/chat/turn.ts`): ownership → paper open for chat (retired → `410 paper_unavailable`) → limits → lock → engine → AI SDK UI message stream. Storage and engine are injected; the route rules are tested with the real `TutorEngine` on in-memory ports and the mock LLM. The stream's `start` part carries ids and the help level, `finish` carries the final text (invalid citations removed), valid citations and progress. Errors before streaming are JSON `{ code, message, retryAt? }` with 4xx/5xx; errors after the first byte are an `error` part whose text is the same JSON. The reply is pumped to completion and the lock released in `finally` even when the client stops reading; `after()` keeps the function alive and runs the history summarizer and the `reply_completed`/`reply_failed` events (ids only).
- **Limits** (FR-9.2, D7 defaults): order spend ceiling (`503 chat_paused`, month-to-date `spend_since`, UTC month) → daily (`429 daily_limit`, `usage_daily` counts completed turns, resets at UTC midnight) → per minute (`429 rate_limited` with `Retry-After`; counted by the new server-only `turns_since()` over student messages and button events in non-test conversations). A retry of an already saved `clientMessageId` is not a new turn for the per-minute window.
- **Generation lock** (§4.4 step 3): `acquire_generation_lock()` / `release_generation_lock()` SQL functions (migration `0005_chat.sql`, execute revoked from browser roles). A concurrent submit gets `409 busy`; a lock older than 2 minutes is taken over.
- **Idempotent Retry** (NFR-14): the browser uses the student message's `clientMessageId` as its `useChat` message id, so Retry (`regenerate()`) re-sends the same key; the engine replays a completed reply or regenerates a failed one. Refusals before saving (limits, busy) put the text back into the composer; failures after saving show "Saved" and Try again.
- **Pages text endpoint.** In addition to §11's `…/pages/:n`, `GET …/versions/:vid/pages` returns all pages' text at once for the accessible-text view and in-document search (versions are immutable, so the browser caches it privately).
- **PDF viewing.** `react-pdf` with `pdfjs-dist` pinned to react-pdf's version (worker URL resolved by the bundler), rendered client-only, pages lazily near the viewport. Because the signed URL lives 10 minutes, range requests are disabled and the file is fetched once. A citation jump highlights the whole page (outline + "Cited in chat · p. N", 4 s, held while hovered or focused) — the handoff's documented fallback; locating the cited passage is deferred.
- **Accessibility mechanics.** Streaming text renders outside the `role="log"` live region (`aria-hidden`) and joins the log when complete, so screen readers hear finished messages only (§2.5). Mobile uses Read/Chat tabs with both panes kept mounted; the view switcher choice lives in `localStorage` inside try/catch (FR-3.1).
- **Dev switches in the mock provider**: `[mock:fail]` fails the first reply to that text, `[mock:slow]` delays one by 6 s, for the manual M6 script (provider failure → Retry, Stop, 409). `LLM_PROVIDER=mock` is refused in production (env validation), so these never reach students.
- **Local PDFs**: `pnpm db:seed-storage` uploads the seeded paper's PDF to the local bucket (`seed.sql` only seeds rows).
- **Scope kept for M7**: mode selector, "Explain it to me" button (the API already accepts `event: "stuck"`), progress drawer, Start over, feedback buttons and the superseded-version banner. The chat header shows the progress count read-only until then.
  Consequences: the read models duplicate the RLS rules in code; `packages/db/test/chat.test.ts` covers the visibility cases next to the RLS suite. Next.js ships `/prompts` with the chat functions via `outputFileTracingIncludes`.

## ADR-026 Tutor features in the UI (M7) · 2026-10-04 · accepted

Context: PRD §3.2–3.3, §8.8, FR-1.5, FR-3.5, FR-3.6, FR-3.8, FR-4.7, §11, open decision D11 and `docs/design/workspace-chat/HANDOFF.md` §4.1–4.5.
Decision:

- **P1 modes behind `TUTOR_MODES`** (D11). Env list of offered focus modes, default `understand,apply`; must include `understand`. Critique and Build ship by adding them (the engine and prompts already support them). Routes refuse a mode that is not offered (`400`); the UI hides those pills and the progress drawer's "Work on this in … mode" button for them.
- **Mode switch route** `POST /api/conversations/:id/mode` takes `{ mode, clientMessageId }` (§11 lists only `mode`): the key makes the switch idempotent like a message turn, so Retry replays it and a double click never posts two handovers. It runs through the same turn adapter (limits, lock, stream). Switching to the current mode answers `409 same_mode` unless it is a retry of the switch. With no conversation yet, choosing a mode creates it in that mode and runs the `start` event (FR-3.2). The finish metadata carries the conversation's mode.
- **Start over** (`POST …/reset`, PRD §8.8: adapter concern): ownership → paper open → generation lock (a reply in flight → `409 busy`) → old conversation `status='reset'` → a new conversation on the paper's **current** version in the same mode (`initialState` = `resetState`) → `{ newConversationId }`. The browser navigates to `?c=<new>`; the workspace is keyed by conversation id, so the chat state remounts, and an empty active conversation sends the `start` event once (deferred so React StrictMode's double mount sends it once).
- **Apply-mode project** (J3, FR-1.5). The engine already reads `profiles.project_description` on every Apply turn and the prompt asks for a project when it is unknown. The UI adds a project card in Apply mode while none is saved, with two explicit choices — "Save to my profile and send" (`PATCH /api/me`, then the text is sent as the reply) and "Send without saving" — plus "Not now". With a saved project, a note under the header links to `/account`.
- **Feedback** (FR-3.6): `POST /api/messages/:id/feedback { rating: 1|-1, comment? }` → 204; one row per (message, student), rating again replaces it. `FeedbackRepo` checks the message is a completed tutor message in the student's own non-test conversation (else 404). The transcript carries the student's feedback so the pressed state survives a reload. 👎 opens an optional comment (≤ 1000 chars).
- **Progress drawer and dialogs** use the native `<dialog>` (`showModal()`: focus containment, Esc, focus return, `::backdrop` scrim) instead of adding Radix/shadcn for two components. Bottom sheet below 640 px.
- **Superseded banner** (FR-3.8; the handoff's proposal): a `bg-panel` bar under the chat header linking to `/papers/[slug]`, which resumes the active conversation on the current version or shows the empty state; the old conversation stays usable.
- **History summarization in `after()`** was already wired in M6 (`maybeSummarizeHistory` after each completed turn); M7 keeps it.
  Consequences: the acceptance checks run as route tests on the real engine with in-memory ports and the mock LLM (no Playwright suite until M10). The "verified via test-chat debug" part of the Apply criterion is shown at the prompt level in those tests; the test-chat debug panel itself is M8.
