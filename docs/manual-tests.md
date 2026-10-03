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