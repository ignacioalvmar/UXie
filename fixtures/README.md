# Fixtures

`papers/<slug>/` holds a paper as `pages.json` (one entry per PDF page, see `PagesFileSchema` in
`packages/core`) plus an approved `guide.yaml`. CLI chat, evals and tests read them through the
in-memory ports, without a database.

| Slug | What it is |
|---|---|
| `visible-cues` | Original **synthetic** paper (fictional study, data and references) written for UXie tests. Safe to commit. |

Do not commit copyrighted papers (PRD §13.5). To use a real paper locally, put it in a git-ignored
folder `fixtures/papers/local-*/` (`source.pdf`, then `pnpm uxie ingest --local` from M3).
Later milestones add a methods-heavy study and an `injected` paper for the prompt-injection eval.
