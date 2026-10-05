# Task 36 — Dashboard states, commands, and backlog

**Status:** Source implementation and code QA passed locally on 2026-10-05.
**Branch:** `cua_pro`. No agent/container restart, push, or deployment was performed.

## Scope

Checklist Task 36 maps to original specification sections 3, 6–7, 21–22, and 47–48: coherent agent/job/key/command status, pagination, refresh errors, and avoiding a false stopped/offline status when the Coordinator cannot be reached.

## Implemented

- Agent list retains its last good response during refresh failures. The page labels it as an unverified snapshot and shows its last successful refresh time; it does not turn a failed network poll into `STOPPED` or `OFFLINE`.
- Agent command/restart/purge controls are disabled while the agent snapshot is stale. Command-history refresh errors are visible without erasing previously loaded history.
- Agent lists paginate locally at 25 entries. The job panel requests up to the latest 100 jobs, paginates at 10, and distinguishes initial loading, a genuine empty response, and an unavailable/stale snapshot. State-changing job actions and starting new work are disabled until a fresh snapshot returns.
- Agent key management uses server-side pages of 50 and displays the returned total. A stale key snapshot is labeled and rotate/rebind/revoke are disabled until refresh succeeds. Older servers that omit `total` remain compatible by falling back to the returned page length.
- Added focused UI/service tests and an engine test for offset pagination and total count.

## QA evidence

Fresh checks on 2026-10-05:

- `npm test` — exit 0; tooling 51 passed/1 skipped; web 905 passed/7 skipped; Gateway 402 passed/53 skipped; engine 534 passed/17 skipped; Review Image 34 passed; Pinterest 22 passed. Skips are opt-in environment-specific tests and are not counted as executed coverage.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0. Existing Vite warnings remain about Node built-ins externalized for browser compatibility and a bundle chunk exceeding 500 kB; no build errors.
- `python -m unittest engine.tests.test_agent_keys -v` from `src/modules/amazon-crawler` — 4 passed, including pagination and count.
- `git diff --check` — exit 0; Git emitted only normal Windows LF-to-CRLF warnings.

## Contract and remaining boundaries

`GET /api/v1/agent-keys` now accepts its existing `limit`/`offset` query parameters in the UI and returns `total` alongside `keys`. No secret-bearing fields were added. This validates the UI/source behavior and automated tests only; public-domain, Docker runtime, and operator visual acceptance are not claimed. Task 37 cross-consumer/runtime regression and Task 38 MVP fault-scenario acceptance remain open.
