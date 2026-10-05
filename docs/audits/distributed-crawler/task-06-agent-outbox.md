# Task 06 — attempt-scoped agent outbox and safe migration

- Baseline: `e97b4df`, branch `cua_pro` as requested (exception to the handbook's per-task branch rule).
- Authorization: user reported Task 05 passed and requested Task 06.
- Original specification: **16–17, 27, 30–31** — local result durability, separation from assignment identity, reopen/retry and duplicate delivery. Partial coverage only: stop/purge, quarantine, asset retention and recovery admission remain later tasks.
- Status: accepted through the user's instruction to proceed to the next task on 2026-10-04; no separate user test output was supplied. Commit: `05fa72b`. The details below record the Task 06 handoff; Task 07 extends the schema and retention behavior separately.

## Implemented behavior

Previously `pending_results` was keyed by task ID and `pending_products` by task/product. A new lease could overwrite the earlier attempt's unsent data; an old acknowledgement could delete the new assignment.

Both outbox tables now have an independent persisted UUID `result_id`. Unique attempt keys are `(task_id, lease_id)` for final results and `(task_id, lease_id, product_key)` for products. Retrying a local save with identical content retains the ID, retry count and original payload. Changed content for the same attempt raises an explicit error and preserves the first record rather than silently replacing it.

- Two attempts for one task coexist, including streamed products.
- ACK and failure bookkeeping select one `result_id`, not every row belonging to a task.
- Final ACK removes only the matching lease; old completion cannot mark a newer lease complete or remove its active assignment.
- Final upload waits only for products from its own lease, not another attempt's pending products.
- Upload deletion requires `accepted`/`duplicate` plus the expected Task 05 receipt ID and exact payload checksum.
- Missing/mismatched receipts, HTTP 404/409, authentication and network errors retain the row for retry. HTTP 409 is no longer treated as duplicate success.

### Identity adapter and compatibility

The local `resultId` selects an immutable outbox row. The wire payload is deliberately unchanged, including migrated payloads: adding a new field would change the checksum of an upload that the server might already have committed before losing its ACK.

Task 05's existing-protocol adapter maps that row's kind/task/client/lease/canonical source key to a stable server `receiptId`. Retry therefore uses the same server identity and checksum while local bookkeeping uses its independent ID. This is not a new arbitrary `result_id` HTTP endpoint. Product source-key calculation is now shared in the existing Python protocol module to keep server and agent receipt verification identical.

A server without Task 05 receipts will not cause data loss: the agent refuses to delete on an unverifiable response. It will retry until a compatible server is available. No protocol-version bump or capability negotiation is introduced in this task; do not roll this agent out independently to old servers.

## Local SQLite migration

SQLite remains the **remote agent's offline spool**, not the production server database. Server data remains PostgreSQL; no container or service was added.

- Local `PRAGMA user_version` advances from unversioned `0` to `1`.
- Before converting an existing spool, SQLite's backup API creates an integrity-checked sibling `agent.sqlite3.pre-outbox-v1-<uuid>.bak`. It includes committed WAL contents; no credentials or payloads are logged.
- Migration holds a writer lock and converts both tables in one transaction. Existing payload JSON, checksums, attempts, errors and timestamps are copied unchanged. Agent identity and other tables are preserved.
- Migration generates one local result ID for each existing row and preserves it on subsequent opens.
- Failure rolls back table conversion and version together; backup failure prevents conversion. A failed backup can leave a `.bak.part` file; it is not a completed backup.
- A higher schema version fails closed. Backup files are local operational data, not source assets to commit/share.

No actual operator agent database was opened or migrated this turn. Tests use temporary files only. Back up and stop the real agent before deployment; do not run the old binary against the new schema. Restoring a pre-migration backup after new results arrive would lose those newer results, so any rollback needs reconciliation first.

## Changed files and scope

Under `src/modules/amazon-crawler/engine/`:

- `distributed/client_outbox_migrations.py`: versioned schema, backup and atomic conversion.
- `distributed/client_store.py`: immutable attempt-scoped spool, exact ACK/retry updates.
- `distributed/client_agent.py`: receipt validation, safe upload failure behavior, lease-scoped completion.
- `distributed/protocol.py`, `coordinator_store.py`: reuse the unchanged canonical product-source algorithm across receipt producer/consumer.
- `tests/test_client_outbox.py`: new migration, isolation and delivery tests.
- `tests/test_distributed.py`, `test_agent_dashboard.py`: update expectations for the intentional immutable-content and ACK API changes.

Docs: progress checklist, baseline-plan status, Task 05 acceptance and this report. No UI, environment setting, dependency, URL or PostgreSQL schema change in Task 06.

## User verification

From `D:\Shopify_Workspace\Tool\ffp_tool`:

```powershell
python -m unittest discover -s src/modules/amazon-crawler/engine/tests -t src/modules/amazon-crawler -p test_client_outbox.py
```

Expected: `Ran 14 tests` followed by `OK`, with no skips. Run it again if desired; each run creates and cleans its own temporary databases. No Docker rebuild, real crawler, Amazon request or Shopify write is required.

Covered cases:

1. Distinct final/product IDs for two attempts; IDs survive reopen.
2. Repeated save preserves ID/retry count; changed content cannot overwrite.
3. Old ACK preserves newer result and assignment.
4. Product ACK/retry targets one row and final blocking is lease-scoped.
5. Old completion cannot mark a new assignment complete.
6. Legacy conversion preserves rows, metadata and agent identity; creates a verified backup; repeated open is stable.
7. Future schema version is rejected.
8. Injected mid-migration failure rolls back both tables and permits retry.
9. Backup failure leaves the legacy schema/data untouched.
10. Missing/wrong receipt preserves the pending result.
11. Matching final receipt removes only that upload, preserving newer active work.
12. HTTP 404/409/401/500 cannot delete products or final results.
13. Product ACK requires the matching checksum.
14. Server commit followed by lost ACK and local reopen: same receipt, one server result, local deletion only after validated retry.

The lost-ACK integration test uses a real CoordinatorStore with a temporary SQLite fixture and a simulated delivery boundary. PostgreSQL receipt behavior is checked separately with `python scripts/audits/audit_lease_baseline.py --receipts`: nine cases twice, no skips, both schemas removed. This does not claim a live WSS/Windows process-crash test.

## Verification record

- Tests were written before implementation: missing IDs, overwrite and stale-completion behavior failed; the three initial delivery tests also failed before agent changes.
- Focused Task 06 suite: 14 passed, zero skips.
- PostgreSQL Task 05 receipt regression: 9 passed twice, zero skips and verified cleanup.
- `npm run typecheck`, `npm run build`: exit 0.
- Full `npm test`: exit 0; engine ran 416 tests with 13 skips. The final additional product-checksum test passed in the separate 14-case focused run after suite discovery. General-suite environment skips do not count as dedicated PostgreSQL proof.
- `git diff --check`: passed.
- Local logs: `%TEMP%\ffp-audit06-npm-test.log`, `%TEMP%\ffp-audit06-typecheck.log`, `%TEMP%\ffp-audit06-build.log`.

No mock selection/composition changed; `build:mock` is not required.

## Remaining risks and stop point

**Do not rebuild/restart the working deployment yet.** Existing stop/discard/purge/reconcile paths can still remove spool rows or assets; Task 07 will change these paths and quarantine stale/cancelled uploads. HTTP failures currently remain in retry, not a new quarantine state. Queue fairness/backpressure and recovery admission are not completed here (Tasks 08–09). Integration acceptance remains Task 10.

- [ ] User confirms the 14-test command passes.
- [ ] User accepts Task 06 and authorizes Task 07 separately.

No push, merge, deployment, installer publication or real agent restart was performed.
