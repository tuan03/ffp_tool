# Tasks 33–35 — Retry, attempt history, and dead-letter queue

**Implementation state:** source changes and QA passed after the user approved seven-day retention and code-based QA.
**Branch:** `cua_pro`. No push, Docker rebuild, deployment, or agent restart was performed.

## Scope and mapping

This batch implements checklist Tasks 33–35 and contributes to the original specification:

- Task 33 → original sections 36–37: stable failure taxonomy, bounded retry budget, durable scheduling, `Retry-After`.
- Task 34 → original sections 44–45 and 48: immutable attempt snapshots, agent/parser versions, duration/checksum, archive on job cleanup, action audit.
- Task 35 → original sections 38 and 48: operator-only paginated DLQ, filtered/single/bulk requeue, soft-delete, confirmation and idempotency.

## Implemented behavior

- Coordinator schema migrations 10–11 persist `max_retry`, `next_retry_at`, requeue cycle count, attempt details, archived attempts, DLQ action audit records, and indexes for bounded retention cleanup.
- Failure classification maps stable categories/codes, redacts and bounds error metadata, applies capped exponential backoff with jitter, and honors parsed `Retry-After`. Permanent failures, exhausted budgets, and expired leases reach `dead_letter`; an expired lease is recorded as `LEASE_EXPIRED` and consumes the durable budget.
- Reassignment creates a new attempt snapshot. Completion/failure records timestamps, elapsed duration, available crawler/parser versions, and result checksum without replacing prior attempts.
- Job cleanup archives attempt snapshots before deleting job rows. DLQ delete is a soft-delete that preserves history. Legacy `retry-failed` endpoint now returns `410`; new DLQ operations require operator authentication, reason, expected-count confirmation, and an idempotency key.
- Requeue starts a new operator retry cycle (resets the active failure counter, increments requeue count), retains all previous attempts/error evidence, and is protected against duplicate action replay. Existing `task_failed` observability is preserved; terminal tasks also emit `task_dead_lettered`.
- Amazon Crawler UI provides paginated/filterable DLQ view, attempt history, selected/error-category retry, and confirmed soft-delete.

## Retention policy

The user approved a **seven-day automatic retention window**. Coordinator maintenance runs cleanup every minute: finished `TaskAttempt` rows older than seven days and archived snapshots archived more than seven days ago are removed. Attempts without `finished_at` are retained, so in-progress work is never deleted. Job cleanup snapshots attempts before deleting job/task rows; archived snapshots then receive their own seven-day window. DLQ “Delete” remains a soft-delete and does not bypass the retention window.

## QA evidence

Fresh checks on 2026-10-05:

- `python -m unittest engine.tests.test_retry_dlq_history engine.tests.test_coordinator_migrations engine.tests.test_lease_mutations engine.tests.test_observability -v` — 32 passed before retention was added; focused post-retention/migration rerun — 8 passed.
- `npm test` — exit 0; web 904 passed/7 skipped, Gateway 402 passed/53 skipped, engine 533 passed/17 skipped, Review Image 34 passed, Pinterest 22 passed; tooling stage also passed. Opt-in skips are not counted as executed coverage.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0. Existing Vite warnings about Node built-ins externalized for browser and large chunks remain; they are outside this batch.
- `git diff --check` — exit 0 (Git only warned about normal LF-to-CRLF conversion on Windows).
- PostgreSQL 17 local test database, each run in a uniquely named schema that the test drops in `finally`: `python -m unittest engine.tests.test_distributed_postgres -v` with `TEST_AMAZON_COORDINATOR_DATABASE_URL` set ephemerally — 3 passed, including migration, DLQ persistence/idempotency, and seven-day retention.

The full `npm test` run leaves PostgreSQL tests skipped when the opt-in URL is absent; the PostgreSQL suite was separately run against the local test database and passed. This is source-level/runtime-in-process evidence, not a Docker rebuild or VPS deployment acceptance.

## Not included

- No public unauthenticated DLQ access.
- No task 36 dashboard consolidation or task 37–38 acceptance work.
- No Docker/VPS runtime validation, agent restart, push, or deployment.
