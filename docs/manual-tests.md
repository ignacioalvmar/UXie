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

Last run: 2026-10-03, steps 1 and 3 (offline; Ollama on this machine is CPU-only with a 4k context
and timed out, which exercised the timeout path). Step 2 pending an API key.
