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
