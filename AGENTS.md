# UXie: Agent Operating Manual

Read docs/PRD.md (§0, §4, §8) before changing code. Work milestone by milestone (§16).

## Commands

- `pnpm install` · `pnpm dev` (web) · `pnpm --filter @uxie/worker dev` (ingestion worker) · `pnpm uxie <cmd>` (CLI)
- Deploys: Vercel (apps/web) and Render (apps/worker, render.yaml) both auto-deploy from main. Never hard-code URLs; read APP_URL.
- `pnpm check` → lint + typecheck + dependency rules + unit/integration tests (must be green)
- `pnpm test:db` → RLS/integration tests (needs `supabase start`) — from M5
- `pnpm test:e2e` → Playwright + axe (needs local Supabase, LLM_PROVIDER=mock) — from M5

## Architecture rules (enforced by dependency-cruiser, `.dependency-cruiser.cjs`)

- packages/core: pure, zod only. No IO.
- packages/tutor: no DB clients, no Next.js, no React, no Discord. Talk to storage via ports.ts.
- packages/character: UI-only, no dependency on other workspace packages.
- Only apps/* wire concrete implementations. apps/* never import each other.
- The browser never writes to the DB directly; server routes use the secret key AFTER explicit authz checks.
- Teaching guides never reach the browser for students.

## Conventions

- zod-validate every external input (env, HTTP body, LLM output, YAML).
- Prompts live in /prompts; never inline prompt prose in TS. Changing a prompt changes prompt_version automatically.
- Never put student text in system prompts. Never send emails/names/IDs to an LLM.
- Tests use LLM_PROVIDER=mock. Never call paid APIs in tests.
- Reference requirement IDs (FR-x.y) in test names and commit messages.
- New decision not covered by the PRD → add an ADR to docs/DECISIONS.md.
- Workspace packages ship TypeScript source (`exports: ./src/index.ts`); apps run them via tsx or Next `transpilePackages`.

## Don't

- Add Redis, queues, vector DBs, ORMs, microservices, or new frameworks without an ADR.
- Log message content at info level or above.
- Weaken RLS or dependency rules to make something pass.
