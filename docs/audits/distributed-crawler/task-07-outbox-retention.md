# Task 07 — preserve unacknowledged uploads during stop and cleanup

- Baseline: `05fa72b`; branch `cua_pro` per user instruction (exception to the handbook's separate-branch rule).
- Authorization: user requested the next task after Task 06. No separate Task 06 test output was supplied.
- Original specification: **9–10, 17, 30, 33**, specifically preserving completed local results during stop/discard/orphan cleanup and preventing stale/cancelled output from automatic publication. This does not complete the later durable remote-command ledger, purge authorization or recovery-admission work.
- Status: awaiting user verification. Task 08 has not started.

## Findings and implementation

`discard_task`, `discard_job` and `clear_orphaned_jobs` previously deleted upload rows alongside assignments. This lost already-produced data without a receipt. Reconcile could also leave an executing stale attempt able to enqueue late output.

The implementation now separates removal of assignment authority from retention of produced results:

| Operation | Assignment | Produced results |
| --- | --- | --- |
| Discard task | Removed | Quarantined, not deleted |
| Stop/discard job | Cancelled/removed according to existing control flow | Quarantined, including uploads whose assignment is already gone |
| Orphan cleanup | Absent jobs' assignments removed | Quarantined with `orphaned_job`; valid jobs remain eligible |
| Reconcile discard while executing | Existing execution cleanup remains responsible for stopping work | Attempt blocked immediately; late output also quarantined |
| HTTP 404/409 during upload | No invented successful ACK | Entire upload attempt quarantined with the HTTP status as reason |
| Server disposition cancelled/stale/conflict | Not treated as success | Attempt quarantined with explicit disposition reason |
| Valid receipt after quarantine began | Does not release quarantine | Local result is retained for review |

`outbox_quarantine` stores result ID, reason and timestamp. `outbox_blocks` persistently blocks the affected job or task/lease. The block and row-retention changes share a SQLite transaction, so a worker finishing after stop cannot make its result eligible again. Different lease attempts and unrelated jobs remain separate.

Upload selection excludes quarantine. The upload loop checks eligibility again before sending a previously selected row. A late ACK cannot delete a quarantined row. This cannot recall a request already in flight before cancellation; server lease/cancellation fencing still applies, and previously committed results are not undone.

Reason codes are local diagnostics, not a new public error contract. `upload_http_409` deliberately does not assume whether an unstructured 409 meant stale lease or checksum conflict. Network/authentication/5xx failures retain the existing retry behavior rather than being silently discarded.

## Asset preservation

The current agent stop paths do not delete generated output directories. Cache cleanup targets cache JSON/checkpoints/abandoned cache writes, not generated PNG/JPEG/output files. No new broad filesystem deletion was introduced.

Tests now keep a real binary fixture referenced by the stored result, exercise local stop plus temporary/cache cleanup and remote stop cleanup, and compare retained bytes/payload. Both result and file remain. Quarantined output is not uploaded automatically.

This is verification of the existing generated-output layout, not a new asset-upload queue, external storage backup, or a general pin for arbitrary files inside the transient cache. Generated assets must remain in durable output locations, not cache temporary files. Manual/external deletion, future retention policies and independent Pinterest upload recovery are not covered by these tests. No claim is made that every Pinterest production scenario was exercised.

## Migration and rollback

- Agent SQLite version advances **1 → 2**; server PostgreSQL schema is unchanged.
- Migration adds the two retention tables without changing payloads or result IDs.
- An integrity-checked `agent.sqlite3.pre-outbox-v2-<uuid>.bak` is created before upgrading a version-1 database.
- Unversioned databases pass through the Task 06 conversion and retention-table creation in one transaction; their pre-conversion backup retains the existing `pre-outbox-v1` naming.
- Failed migration rolls back version and tables; a subsequent retry preserves the same results.
- Existing operator databases were not migrated this turn; all tests use temporary files.
- Old binaries are not supported against version 2. Never restore an older backup over newer results without first reconciling those results.

No automatic expiration, release or deletion of quarantine is provided. This intentionally preserves data until an explicit reviewed recovery/retention workflow is implemented. Do not manually remove block rows to republish a cancelled job. Quarantine can grow; backpressure belongs to Task 08.

## Changed files

Under `src/modules/amazon-crawler/engine/`:

- `distributed/client_outbox_retention.py`: transaction helpers for quarantine and durable job/attempt blocks.
- `distributed/client_outbox_migrations.py`: version 2, backup and atomic additive migration.
- `distributed/client_store.py`: preserve outbox across cleanup, filter eligible uploads, block late writes, protect quarantined records from ACK deletion; metadata-only `quarantined_uploads()` diagnostics.
- `distributed/client_agent.py`: immediate reconcile blocking and upload rejection handling; recheck quarantine before send.
- `tests/test_outbox_retention.py`: focused preservation/migration/agent-flow tests.
- `tests/test_client_outbox.py`, `test_distributed.py`, `test_agent_dashboard.py`: schema-version and quarantine expectation updates.
- Audit checklist, plan status, Task 06 acceptance and this report.

No UI, external route, environment variable, dependency, container topology or server database change. `upload_counts()` continues to count all retained records, including quarantine; `pending_*()` lists only records eligible for upload. A quarantine UI is not part of this task.

## User test

From the repository root:

```powershell
python -m unittest discover -s src/modules/amazon-crawler/engine/tests -t src/modules/amazon-crawler -p test_outbox_retention.py
```

Expected: **`Ran 13 tests`**, **`OK`**, no skips. Tests create and clean temporary agent databases and binary fixtures; they do not touch real jobs, assets or stores. Rebuild is not needed.

Coverage: discard task; discard job after assignment removal; orphan cleanup/reopen/reason; late results after stop; attempt isolation; ACK/quarantine race; v1 migration backup/ID preservation; unrelated valid job; migration rollback; local stop/cleanup/file preservation; remote stop; executing-task reconcile; HTTP conflict/no subsequent publish.

## Verification

- Six initial retention tests failed before implementation (five failures, one missing-method error).
- First full regression exposed a legacy dashboard assertion that stop deletes results; it was updated to assert retained/quarantined data. The focused dashboard suite then passed (28 cases, 7 environment skips).
- Task 07 focused suite: 13 passed, no skips.
- Task 06 focused regression: 14 passed, no skips.
- PostgreSQL receipt regression: 9 tests in each of two schemas, no skips; both cleanup confirmations verified.
- `npm run typecheck`, `npm run build`: exit 0.
- Full `npm test`: exit 0 on the final rerun. General-suite environment skips are not dedicated PostgreSQL evidence. `git diff --check`: passed.
- Logs: `%TEMP%\ffp-audit07-npm-test.log`, `%TEMP%\ffp-audit07-typecheck.log`, `%TEMP%\ffp-audit07-build.log` (not committed).
- No mock composition changed; `build:mock` not required.

## Stop point

- [ ] User runs the focused suite and accepts Task 07.
- [ ] User separately authorizes Task 08.

No rebuild, restart, push, deployment or installer release was performed. Do not deploy the partial reliability series yet: storage backpressure (Task 08), recovery admission (Task 09) and integrated acceptance (Task 10) remain.
