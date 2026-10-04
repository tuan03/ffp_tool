# Task 10 — reliability integration gate (G1)

## Scope and status

- Baseline: `fdae665`; branch `cua_pro` retained by explicit user instruction (exception to per-task branching).
- User authorized Task 10 after the Task 09 handoff; no new manual-test transcript was supplied for Task 09.
- Original specification: **13–18, 25–27, 30–31, 49**, reliability acceptance for Tasks 02–09, not completion of all criteria in these sections.
- Ownership: `scripts/audits/` test harness and crawler audit documents. No production implementation change was needed by the passing scenarios.
- Status: assistant integration checks passed; user acceptance pending. Task 11 has not started.

## What runs and what does not

The harness uses the existing loopback-only `ffp-local-postgres` container, creates a random `ffp_audit01_<uuid>` schema, excludes `public` from its search path, and removes only that schema in `finally`. Cleanup verifies its absence. Credentials are read in memory from Docker inspection, never printed.

The actual Coordinator FastAPI application runs with Uvicorn on an ephemeral loopback port, including its lifespan, migration and reaper. Two actual `DistributedCrawlerAgent` objects run their connection, heartbeat, reconciliation, upload and completion loops, with separate temporary directories, SQLite spools and identities. HTTP and WebSocket transport are real. Only the database engine/resource paths are injected; browser execution is replaced with a failing sentinel so a regression cannot crawl Amazon.

This is an **in-process fixture-agent test**, not two installed Windows agents or an OS-process kill test. Runtime objects and the Coordinator application are stopped/recreated over the same durable stores to test restart. A deliberate WebSocket close separately tests actual transport disconnect and automatic reconnect. The ACK-loss fault commits through HTTP and intentionally does not apply the reply to the local spool.

No container was rebuilt/restarted/created, no application database migrated, no live agent stopped, no Amazon/Shopify call made, no installer built, no VPS change or push performed. The fresh source-based test runtime replaces the need to rebuild the user's working stack for G1; production topology remains unchanged. Container/Nginx and real browser/process lifecycle acceptance belong to later gates, not this result.

## Evidence matrix

Each complete run is repeated in a second fresh PostgreSQL schema.

| Scenario | Expected and observed |
| --- | --- |
| Existing mutation-authority suite | 9 tests pass, zero skips; stale heartbeat/progress/failure/cancel/reconcile cannot take over B |
| Existing durable-receipt suite | 10 tests pass, zero skips; includes concurrent final uploads, rollback and migration checks |
| Streaming stale/current/duplicate | Expired/reassigned A rejected; B accepted then duplicate; one B-owned pipeline item |
| Two simultaneous PostgreSQL lease claims | Exactly one winning lease for one task |
| A expires; B receives replacement lease | Same task, different lease; A's local result remains durable |
| B streams product and submits final through HTTP, ACK intentionally lost | Server accepts both while local spool retains both |
| Reopen B before retry | Identity and final result ID unchanged |
| Two agents connect via actual WebSocket | Reconciliation completes; B's duplicate receipts drain its spool without recrawl |
| Stale A retention | One quarantined result and fixture binary retained |
| Server counts after retry | Exactly one final result and one product, both owned by B; zero crawler invocations |
| Forced WebSocket disconnect | Both agents close admission (zero slots), reconnect automatically and do not recrawl |
| Coordinator and agents recreated | Identity, server rows and local quarantine/ACK dispositions survive; fixture asset unchanged |
| Cleanup | Temporary agent directories and the exact test schema removed |

The initial harness attempt correctly failed HTTP validation because the fixture omitted envelope identity fields. The fixture was corrected to match route/header identity; production validation was not weakened.

## Repeatable user test

From the repository root, with Docker Desktop and the existing `ffp-local-postgres` running:

```powershell
python scripts/audits/audit_lease_baseline.py --reliability
```

Expected for both `RUN 1` and `RUN 2`:

- `mutation tests=9, failures=0, skipped=0`
- `receipt tests=10, failures=0, skipped=0`
- `two-agent HTTP/WSS recovery PASS`
- `own test schema removed and absence verified`

Final line:

```text
PASS: Task 10 PostgreSQL and two-agent HTTP/WSS recovery verified twice; awaiting user acceptance.
```

The command exits nonzero on failure. It does not start a missing PostgreSQL container or silently fall back to SQLite. No manual cleanup is needed after a normal success/failure. If the interpreter is forcibly killed, do not delete arbitrary schemas or agent folders: identify the exact schema printed by that run before any cleanup.

## Compatibility and remaining gates

Fresh verification: `npm test`, `npm run typecheck`, and `npm run build` exited 0. The crawler suite ran 453 tests with 13 conditional skips; required PostgreSQL audit suites had zero skips. Review Image ran 34 tests plus extension checks; Pinterest ran 14. Existing Vite browser-externalization/chunk-size warnings remain. No mock/runtime composition change, so `build:mock` was not required.

- No public contract, production route, environment setting, dependency or database schema change. New `--reliability` is an opt-in audit CLI flag; older harness modes remain available.
- Full source regression includes outbox pressure/retention, cache integrity and existing partial-family/streaming coverage; this is not a real Amazon crawl or a production performance benchmark.
- OS hard-crash/browser ownership, 20-agent fleet testing, Nginx/public TLS, installation on a clean machine, and later auth/control contracts remain outside G1.
- Task 11 requires explicitly revisiting D1/D5/D6 (authentication, agent permissions, identity binding). Do not silently override the earlier public/no-auth exception or implement Task 11 before approval.
