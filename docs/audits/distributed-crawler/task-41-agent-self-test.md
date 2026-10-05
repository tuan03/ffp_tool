# Task 41 — Read-only agent self-test

## Result

Implemented `RUN_SELF_TEST` as a durable, operator-audited agent command. The action is exposed in the Amazon Crawler agent controls and requires a connected agent plus a reason of at least 10 characters. It does not create crawl work, alter assignments, edit products, or upload test records.

The agent reports four bounded checks:

- **Authentication:** the authenticated Coordinator session carrying the command is active; no credential is returned.
- **Disk/storage:** free space and the existing outbox admission probe, plus SQLite `PRAGMA quick_check`; paths and payloads are not exposed. Blocking storage/integrity faults are FAIL; backlog-age warnings are DEGRADED.
- **Worker:** current rolling worker-health state and bounded counts; degraded health remains visible and no worker process is spawned/reset.
- **Serialization:** the bounded report is JSON round-tripped and constrained to 4 KiB before delivery.

Overall state is FAIL if any check fails, DEGRADED if none fail but at least one is degraded, otherwise PASS. The Coordinator persists only the allowlisted status/check fields; unknown fields (including credential-like values) are discarded. The command is idempotent for a given request ID and does not change desired/applied execution state.

## Original specification mapping

- Distributed crawler specification: §8, Task 41 (safe self-test).
- Project checklist: Task 41, dependency E5.2.

## Verification

- `python -m unittest engine.tests.test_client_self_test engine.tests.test_agent_commands -v`: 32 passed.
- Amazon Crawler service tests: 35 passed.
- `npm test`: exit 0; JavaScript 455 tests (402 passed, 53 skipped), crawler engine 555 tests (537 passed, 18 skipped), Review Image 34 passed, Pinterest 22 passed; tooling suites passed.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0. Existing Node-module externalization and chunk-size warnings remain.
- Tests cover PASS/DEGRADED/FAIL, serialization failure, no outbox mutation, audited API request, request-id idempotency, and server-side result allowlisting.
- No Compose rebuild/restart, production DB migration, push, or deployment was performed.

## Limitations

- The check confirms an active authenticated session carrying the command; it does not prove access to external Shopify or crawl-source services (neither is invoked by design).
- UI behavior has automated contract/build coverage but has not been manually exercised with a physical agent in this task.
