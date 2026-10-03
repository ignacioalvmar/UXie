# UXie

UXie is an agentic service for vibecoding students to explore and understand seminal academic papers.
Students read an instructor-published paper in the browser and talk with UXie, a Socratic tutor that
asks one focused question at a time, gives graduated hints, cites the exact PDF pages it relies on,
and helps turn the paper's concepts into justified UX decisions.

The specification is [docs/PRD.md](docs/PRD.md); decisions are logged in
[docs/DECISIONS.md](docs/DECISIONS.md); coding agents start at [AGENTS.md](AGENTS.md).

## Status

| Milestone | Scope                                                     | State                               |
| --------- | --------------------------------------------------------- | ----------------------------------- |
| M0        | Monorepo, tooling, dependency rules, CI, deploy configs   | done (deploy pending account setup) |
| M1        | Pure pedagogical core                                     | done                                |
| M2        | LLM gateway (Anthropic, OpenAI, Gemini), engine, CLI chat | done (verified with Claude)         |
| M3        | Ingestion (unpdf, docling), analysis, guide drafting      | done (verified with Claude)         |
| M4–M10    | Eval, data layer, UI, admin, launch                       | planned                             |

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
pnpm dev                 # web on http://localhost:3000
pnpm --filter @uxie/worker dev
pnpm uxie --help
pnpm uxie chat visible-cues --provider mock --debug   # terminal tutor, no keys needed
pnpm uxie ingest paper.pdf --paper local-x --local     # extract + draft a guide into fixtures/papers/local-x
```

## Deploy (walking skeleton)

Both services deploy from `main` (ADR-011).

**Vercel (apps/web).** Import the GitHub repo → Root Directory `apps/web` → framework Next.js
(pnpm is detected from the lockfile). `apps/web/vercel.json` pins functions to `fra1`. Add env vars
per environment once the data layer lands (M5). Attach `uxie.<your-domain>` later (Namecheap
`CNAME uxie → value shown by Vercel`).

**Render (apps/worker).** New → Blueprint → select the repo; `render.yaml` defines the
`uxie-worker` background worker (Frankfurt) and the `uxie-prod` env group. Enter the secret values
when prompted (`LLM_API_KEY`, Supabase keys). The worker has no public port.

**Supabase.** Created at M5 (EU/Frankfurt, separate dev and prod projects).
