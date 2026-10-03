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
