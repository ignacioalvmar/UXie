# UXie

UXie is an agentic service for vibecoding students to explore and understand seminal academic papers.
Students read an instructor-published paper in the browser and talk with UXie, a Socratic tutor that
asks one focused question at a time, gives graduated hints, cites the exact PDF pages it relies on,
and helps turn the paper's concepts into justified UX decisions.

The specification is [docs/PRD.md](docs/PRD.md); decisions are logged in
[docs/DECISIONS.md](docs/DECISIONS.md); coding agents start at [AGENTS.md](AGENTS.md).

## Status

| Milestone | Scope                                                        | State                               |
| --------- | ------------------------------------------------------------ | ----------------------------------- |
| M0        | Monorepo, tooling, dependency rules, CI, deploy configs      | done (deploy pending account setup) |
| M1        | Pure pedagogical core                                        | done                                |
| M2        | LLM gateway (Anthropic, OpenAI, Gemini), engine, CLI chat    | done (verified with Claude)         |
| M3        | Ingestion (unpdf, docling), analysis, guide drafting         | done (verified with Claude)         |
| M4        | Eval harness, benchmark, load test (decision gate)           | harness done; provider ADR proposed |
| M5        | Supabase data layer, RLS, auth, onboarding, AI settings      | done (provider switch check in M6)  |
| M6        | Library, workspace (PDF + chat), limits, lock, retries       | done (mock LLM; local stack)        |
| M7        | Modes, Explain-it, progress, Start over, feedback            | done (mock LLM; local stack)        |
| M8        | Admin content: upload, worker ingest, guides, test, publish  | done (mock LLM; local stack)        |
| M9        | Review, reports, exports, data rights, costs, admin health   | done (mock LLM; local stack)        |
| M10       | Security headers, e2e + axe, alerts, launch tooling and docs | code done; launch steps with owner  |

## Layout

```
apps/web        Next.js app (Vercel, fra1)            apps/cli     `pnpm uxie <cmd>`
apps/worker     ingestion worker (Render, Frankfurt)
packages/core   pure schemas + state machine          packages/llm      provider-agnostic gateway
packages/tutor  TutorEngine + ports                   packages/ingest   PDF extraction, guide drafts
packages/db     Supabase repos                        packages/eval     simulated students, benchmark
packages/character  animated UXie embodiments (React)
prompts/        versioned prompt templates            fixtures/papers/  test papers + guides
```

Dependency boundaries between these are enforced by `dependency-cruiser` (PRD §4.3).

## Develop

Requires Node 22+ and pnpm 11 (`corepack enable`).

```bash
pnpm install
cp .env.example .env     # LLM_PROVIDER=mock works without any keys
pnpm check               # lint + typecheck + dependency rules + tests
pnpm test:db             # RLS + repositories (needs `pnpm exec supabase start`)
pnpm test:e2e            # Playwright + axe on the production build + worker (local stack, mock model)
pnpm dev                 # web on http://localhost:3000
pnpm --filter @uxie/worker dev   # ingestion worker; needs the Supabase vars in .env (or exported)
pnpm uxie --help
pnpm uxie chat visible-cues --provider mock --debug   # terminal tutor, no keys needed
pnpm uxie ingest paper.pdf --paper local-x --local     # extract + draft a guide into fixtures/papers/local-x
pnpm uxie eval visible-cues --runs 1 --turns 4         # simulated students + judge → eval-results/<date>/
pnpm uxie eval visible-cues --providers anthropic:claude-sonnet-5-5@low,anthropic:claude-haiku-4-5
pnpm uxie loadtest --concurrency 5,10,15 --duration 1m # TTFT p95 + error rate under load
pnpm uxie guide pull visible-cues --out guide.yaml      # edit a DB guide in your editor …
pnpm uxie guide push visible-cues guide.yaml           # … validate + save as draft (newest version)
pnpm uxie guide approve visible-cues && pnpm uxie publish visible-cues
pnpm uxie report visible-cues                          # class report (Markdown)
pnpm uxie costs --month 2026-10                        # usage and cost summary
pnpm uxie export --research --format csv --out x.csv   # research export, logged
pnpm uxie purge --before 2026-03-31 --dry-run          # retention purge (counts only)
```

## Deploy

Production runs on Vercel (web, `fra1`) + Render (worker, Frankfurt) + Supabase (EU, Frankfurt),
with the domain on Namecheap (ADR-011). Both services deploy `main`; migrations go first through
the manual **DB migrate** GitHub Action. The step-by-step setup (Supabase projects, GitHub
environments, email provider, DNS records, Auth settings, Render Blueprint, Vercel env and domain)
is in [docs/runbook.md → Production setup](docs/runbook.md#production-setup-m10-prd-171);
releases, rollback, backup/restore drills and routines follow it there.

Before launch, with the production env exported:

```bash
pnpm uxie doctor --launch   # automated launch checks (exit 1 on blockers) + the manual items
pnpm uxie doctor --ping     # one tiny request per configured provider/model
```

then work through [docs/launch-checklist.md](docs/launch-checklist.md) (PRD §17.3 and the M10
acceptance criteria).

**Local stack.** `pnpm exec supabase start` (Docker), then `pnpm test:db`. `pnpm db:seed-storage`
uploads the seeded paper's PDF so the workspace can show it (sign in as `student.a@thi.de`,
password `uxie-dev-password`, local stack only). `pnpm test:e2e` builds the web app and runs the
Playwright suite on port 3100 with its own worker; it creates and removes synthetic `e2e-…`
accounts and papers and refuses to run against a hosted project.
