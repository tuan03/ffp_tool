# Task 09 — reconcile before accepting or starting work

## Scope and specification mapping

- Baseline: `8217bbe`; branch `cua_pro`, retained by explicit user instruction instead of creating a per-task branch.
- Original specification: **18, 25–27, 30, 51–52**, specifically reconnect/restart and durable-result recovery. This does not finish every criterion in these sections.
- Ownership: crawler agent, Coordinator reconciliation, focused tests and audit documentation only.
- Status: implemented; awaiting user acceptance. Task 10 has not started.

## Behavior

1. Start/reconnect advertises zero capacity. Outbound WSS remains the transport; no new HTTP polling service or container.
2. Reconciliation applies cancellation, cache invalidation and temporary-cleanup controls before approving queued execution.
3. Coordinator distinguishes a live resumable lease from an already committed final result. The latter is returned as `uploadTaskIds`: retry the durable receipt, never crawl again just because its ACK was lost. Cancellation/deletion takes precedence; a different owner/lease is not granted receipt recovery.
4. Upload processing performs its first bounded pass (up to 50 products and 20 final results). The admission gate then opens subject to existing storage, pause and stop-cleanup checks. A failed upload remains retryable or quarantined according to its disposition; opening the gate does not declare every upload successful or require draining the entire backlog.
5. Old queued capacity is recalculated at send time. Queued assignments need explicit approval for their task/lease and a still-executable durable local record. Repeated reconnect does not enqueue duplicate work; completed-pending-upload records are not executable.
6. Disconnect closes admission. Work already executing may finish and spool its result, as permitted by specification section 25; work waiting locally must wait for reconciliation. Reconnect retains existing jittered exponential backoff.

## Compatibility and boundaries

- Additive `hello_ack.uploadTaskIds` field; matching updated Coordinator and agent are required for automatic final-ACK recovery. An older server can still classify the attempt as discarded; existing quarantine retains the payload rather than deleting it.
- No PostgreSQL/SQLite schema migration, new environment variable, dependency, public HTTP route or container.
- Coordinator remains in the existing server container; remote agent remains outside VPS containers. PostgreSQL is server persistence; agent SQLite remains its local durable spool.
- An unfinished crawl after a process crash may restart browser work under a still-valid reconciled lease. This is not exact browser/checkpoint resumption. Expired or cancelled attempts remain quarantined, not revived.
- No new command ledger, authentication, protocol-version enforcement, installer/release or production rollout; later tasks own these.
- First-pass recovery does not guarantee all HTTP calls succeed, nor instantaneous cancellation of an HTTP call already running in a thread.

## Verification and user test

From the repository root in PowerShell:

```powershell
python -m unittest discover -s src/modules/amazon-crawler/engine/tests -t src/modules/amazon-crawler -p "test_agent_recovery.py"
python scripts/audits/audit_lease_baseline.py --receipts
```

Expected: 8 recovery tests pass; PostgreSQL receipt suite runs 10 tests twice with zero failures/skips and verifies removal of each isolated audit schema. The harness's final Task 05 acceptance wording belongs to the reused receipt harness, not the current checklist status.

Focused regression also covers Task 06–08 outbox behavior (49 tests total including recovery). The recovery suite opens a real loopback WebSocket, verifies zero-capacity hello, then readiness after the upload gate; it also tests failed control reconciliation, offline queue blocking, duplicate reconciliation and stale queued capacity. PostgreSQL tests verify same-writer receipt-only classification and wrong-owner rejection.

No live agent or application container was restarted. Real two-agent disconnect/restart acceptance remains the **Task 10** integration gate; it must use updated test runtime, not a production rollout. User approval is required before advancing.

Build verification: `npm run typecheck` and `npm run build` passed. Existing Vite browser-externalization and chunk-size warnings remain outside this change. No mock/runtime composition changes, so `build:mock` is not required.

`npm test` passed after updating the pre-existing executor fixture to explicitly simulate a reconciled connection: crawler suite 453 tests, 13 conditional skips; Review Image 34 tests plus extension checks; Pinterest 14 tests. Gateway reported 402 passing and 53 conditional skips. Focused recovery/outbox suite: 49 passing. PostgreSQL receipt suite: 10 passing in each of two isolated schemas, no skips.
