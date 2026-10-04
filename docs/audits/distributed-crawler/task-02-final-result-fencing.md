# Task 02 — current-lease final results

## Status and scope

- Baseline: `04f28ad`, branch `cua_pro`.
- User verified Task 01 and explicitly authorized Task 02/current-lease final results.
- Original specification: sections 13–15 and 19, **final-result path only**.
- Status: awaiting user verification; Task 03 has not started.
- Runtime change: only `CoordinatorStore.accept_result()`; no migrations, dependencies, environment variables, or new routes.
- No Docker rebuild/restart, VPS deployment, or push. Running application containers still use their previously built code. The audit imports the updated local checkout.

## Implemented contract

Under the existing task row lock, a new final result requires:

1. Task status `leased` or `running`.
2. Current assigned client and lease ID match the submission.
3. A non-null lease deadline strictly later than server time. At/after expiry it is stale, even if the reaper has not run and the task has not been reassigned.
4. Existing attempt and job identity checks still pass.

A stale submission returns the existing `stale` status, mapped by the existing HTTP route to **409**. It cannot insert the final result or products embedded in that final result, complete the task, or replace the current owner's lease.

After a result is committed, a retry from its stored client/lease with the correct job identity still returns `duplicate`/HTTP 200 despite the lease deadline having been cleared. A different client/lease cannot receive another writer's successful ACK.

This is not the complete result-receipt design: comparison of duplicate content with the stored checksum and independent `result_id` handling remain Task 05. No new checksum-conflict contract is claimed here.

## Test-first evidence

Four focused store tests were run before changing runtime code: all four failed (six failed assertions including subcases), demonstrating acceptance of expired/stale/non-executable submissions and overly broad duplicate ACKs. After the change, all four passed.

A separate HTTP test passed: old A receives 409; current B receives 200/accepted; B's lost-ACK retry receives 200/duplicate; A's later retry still receives 409. This route test uses a temporary SQLite test database; PostgreSQL verification below is separate and real, not a skipped integration test.

## PostgreSQL verification and user test

Run in PowerShell:

```powershell
Set-Location D:\Shopify_Workspace\Tool\ffp_tool
python scripts/audits/audit_lease_baseline.py --expect current-lease
```

Uses the same existing `ffp-local-postgres` loopback connection and uniquely generated disposable schema as Task 01. Each run checks its isolated search path, performs two repetitions, drops only its own fixture schema and verifies absence. No application tables are targeted and no real Amazon/Shopify requests are sent.

Expected and observed in both repetitions:

| Step | Task 01 baseline | Task 02 actual |
| --- | --- | --- |
| A expired, before reaper | Not measured by old harness | `stale` |
| A late after B reassignment | `accepted` | `stale`; B's lease unchanged, no result inserted |
| B sends valid final result | `duplicate` | `accepted` |
| B retries after completion | Not measured by old harness | `duplicate` |
| A retries after B completion | Not measured by old harness | `stale` |
| Stored final result | A, one row | B, one row |
| Attempt states | A completed / B leased | A abandoned / B completed |

Final output:

```text
PASS: current-lease final result verified twice; product streaming and other mutation paths are NOT covered.
```

The old command without `--expect current-lease` intentionally expects the pre-fix behavior and no longer passes on this checkout. Task 01's historical report remains unchanged except for that compatibility notice.

## Remaining boundaries and rollout risk

- Product streaming's separate endpoint is unchanged: Task 03 must fence it too. The whole lease-token requirement is not complete yet.
- Progress/fail/heartbeat/reconcile paths are unchanged: Task 04 remains necessary. This test does not prove they cannot restore stale authority.
- Agent currently treats final-upload HTTP 409 as cancellation and removes that pending result. **Do not roll this partial change out to real running agents** before the planned outbox/recovery work and combined gate. This task tests isolated fixtures only.
- Full checksum-conflict receipts, new result IDs, auth and quarantine are not implemented here.
- Sequential PostgreSQL A/B tests do not prove concurrent reaper/cancel/lease race safety. Combined concurrency verification remains a later gate.
- Existing untracked files `Nguồn`, `Nhánh`, `Trạng`, `Tài` were preserved and excluded from the task commit.

## Fresh verification

| Command/check | Result |
| --- | --- |
| Four focused store tests | Failed before runtime edit; passed afterward |
| Focused final-result HTTP test | Passed |
| `python scripts/audits/audit_lease_baseline.py --expect current-lease` | Exit 0, two isolated PostgreSQL repetitions; fixture schemas removed and absence checked |
| `npm test` | Exit 0: tooling 51 pass/1 skip, web 887 pass/7 skip, gateway 402 pass/53 skip; engine 383 run/12 skip; Review Image 34 pass plus extension scripts; Pinterest 14 pass |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0; bundle-size warning remains |
| `git diff --check` | Passed |

General-suite skips are not counted as verified coverage. The dedicated PostgreSQL harness has no skip path and did execute. Mock selection/composition was unchanged; `build:mock` was not rerun. Local logs remain outside Git at `%TEMP%\ffp-audit02-npm-test.log`, `%TEMP%\ffp-audit02-typecheck.log`, and `%TEMP%\ffp-audit02-build.log`.

## User acceptance

- [ ] Run the command with `--expect current-lease` and see PASS plus cleanup for both repetitions.
- [ ] Confirm A is stale, B accepted, B retry duplicate, and stored result belongs to B.
- [ ] Accept Task 02's final-result-only scope and remaining limitations.
- [ ] Authorize Task 03 separately when ready.

No automatic progression to Task 03 or production deployment follows a passing test.
