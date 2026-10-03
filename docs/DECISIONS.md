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
