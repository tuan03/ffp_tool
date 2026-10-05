# Tasks 33–35 — Retry, attempt history, and dead-letter queue

**Implementation state:** source changes and local QA passed; checklist remains unaccepted until user review.
**Branch:** `cua_pro`. No push, Docker rebuild, deployment, or agent restart was performed.

## Scope and mapping

This batch implements checklist Tasks 33–35 and contributes to the original specification:

- Task 33 → original sections 36–37: stable failure taxonomy, bounded retry budget, durable scheduling, `Retry-After`.
- Task 34 → original sections 44–45 and 48: immutable attempt snapshots, agent/parser versions, duration/checksum, archive on job cleanup, action audit.
- Task 35 → original sections 38 and 48: operator-only paginated DLQ, filtered/single/bulk requeue, soft-delete, confirmation and idempotency.

## Implemented behavior

- Coordinator schema migration 10 persists `max_retry`, `next_retry_at`, requeue cycle count, attempt details, archived attempts, and DLQ action audit records.
- Failure classification maps stable categories/codes, redacts and bounds error metadata, applies capped exponential backoff with jitter, and honors parsed `Retry-After`. Permanent failures, exhausted budgets, and expired leases reach `dead_letter`; an expired lease is recorded as `LEASE_EXPIRED` and consumes the durable budget.
- Reassignment creates a new attempt snapshot. Completion/failure records timestamps, elapsed duration, available crawler/parser versions, and result checksum without replacing prior attempts.
- Job cleanup archives attempt snapshots before deleting job rows. DLQ delete is a soft-delete that preserves history. Legacy `retry-failed` endpoint now returns `410`; new DLQ operations require operator authentication, reason, expected-count confirmation, and an idempotency key.
- Requeue starts a new operator retry cycle (resets the active failure counter, increments requeue count), retains all previous attempts/error evidence, and is protected against duplicate action replay. Existing `task_failed` observability is preserved; terminal tasks also emit `task_dead_lettered`.
- Amazon Crawler UI provides paginated/filterable DLQ view, attempt history, selected/error-category retry, and confirmed soft-delete.

## Retention decision / limitation

No approved numeric retention window or storage budget was available for D9. Therefore this batch does **not** automatically delete attempt history or archived attempt evidence. This favors auditability but allows archive storage to grow. Choosing and implementing bounded retention/compaction remains an explicit follow-up decision; Task 34 must not be considered fully accepted until that policy is reviewed. Deleting a DLQ entry is not physical deletion.

## QA evidence

Fresh local checks on 2026-10-05:

- `python -m unittest engine.tests.test_retry_dlq_history engine.tests.test_coordinator_migrations engine.tests.test_lease_mutations engine.tests.test_observability -v` — 32 passed.
- `npm test` — exit 0; engine suite 531 passed/16 skipped, Review Image 34 passed, Pinterest 22 passed; tooling/web/Gateway stages also completed successfully. Opt-in skips are not counted as executed coverage.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0. Existing Vite warnings about Node built-ins externalized for browser and large chunks remain; they are outside this batch.
- `git diff --check` — exit 0 (Git only warned about normal LF-to-CRLF conversion on Windows).

The suite used local SQLite-backed unit/integration fixtures. The opt-in isolated PostgreSQL test was skipped because this run did not configure `TEST_AMAZON_COORDINATOR_DATABASE_URL`; PostgreSQL runtime compatibility therefore still needs that test gate before deployment.

## Not included

- No public unauthenticated DLQ access.
- No task 36 dashboard consolidation or task 37–38 acceptance work.
- No Docker/VPS runtime validation, agent restart, push, or deployment.
