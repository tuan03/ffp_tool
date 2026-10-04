# Task 04 — lease authority for mutation and reconnect paths

- Baseline: `d59af71`, working branch `cua_pro`.
- User verified Task 03 and explicitly authorized Task 04.
- Original specification: sections 13–15, 19 and 27; related heartbeat/recovery/cancel semantics in 7, 26, 35 and 51.
- Status: accepted through the user's instruction to proceed to the next task on 2026-10-04. No separate user-side test output was supplied; assistant verification below is the recorded evidence. Task 05 is now implemented and awaiting its own acceptance.

## Findings and runtime changes

| Path | Before | After |
| --- | --- | --- |
| Heartbeat | Matching client/token could renew an expired lease before reaper | Renew only a current, non-expired leased/running task without a durable final result |
| Progress | Matching client/token could renew an expired lease and append progress | Same live-authority check; stale progress performs no task/event writes |
| Failure | An expired matching lease could increment failure budget, set retry/error/cache state | Returns stale before those writes |
| Reconnect | Queued task could be reclaimed with local token; expired lease could resume | Resume only current, non-expired leased/running authority; queued task must go through scheduler |
| Reconnect job identity | Client-provided unrelated tombstone could cancel a real task | Validate task/job match before interpreting supplied job cancellation/tombstone |
| Cancel received/complete ACK | Existing owner/token checks blocked old A from cancelling new B | Preserve behavior, add task row lock and scope attempt lookup by task + client + lease |

The changed task mutation paths now read the task with `FOR UPDATE` in PostgreSQL. Expiry is checked using server time after acquiring the row lock rather than a stale timestamp captured before waiting.

Progress no longer repairs a task on behalf of a late message when a durable final result exists; it returns without mutation. Existing reaper repair remains available. This avoids an unrelated/stale sender changing state while still preventing completed work being reopened.

### Cancellation is not execution authority

Cancellation ACK for the correct cancelling/cancelled task may still arrive after lease expiry. It confirms that execution stopped; it does not grant permission to execute or publish a result. This intentional behavior is retained, including existing late-cancel tests. Foreign/old ACKs cannot cancel the new owner's active task. Some terminal no-op responses remain `duplicate`, which does not renew a lease or write a result.

Heartbeat may still update the agent's last-seen/telemetry even if its reported task lease is stale. Connectivity is distinct from authority to mutate a task.

## Scope and deployment limits

- Runtime edits only in `coordinator_store.py`, inside the existing Coordinator process of the server container.
- No schema migration, new route, dependency, environment variable, or container topology change.
- Existing response shapes are retained: invalid reconnect entries are in `discardTaskIds`; stale failure returns `stale`; stale heartbeat/progress task updates are ignored.
- Agent reconnect/discard and upload-409 paths still have the previously documented outbox-deletion behavior. Keep this partial series off real running agents until outbox/recovery work and the combined gate are approved.
- No rebuild/restart, push or VPS deploy. The audit exercises the updated local checkout; running container images are unchanged.
- Four unrelated untracked files (`Nguồn`, `Nhánh`, `Trạng`, `Tài`) are untouched and excluded from the task commit.
- Sequential tests and adding locks do not prove every race involving scheduler/reaper/cancel-job transactions. Complete concurrent race/load checks remain part of the combined reliability gate; no claim of full spec completion yet.

## Test-first evidence

New suite `engine.tests.test_lease_mutations`: 9 cases. Before runtime edits, 6 failed and 3 passed. After edits, all 9 passed on SQLite fixtures and then all 9 passed twice on actual PostgreSQL with zero skips.

Cases:

1. Expired heartbeat cannot renew the lease.
2. Expired progress cannot renew or append an event.
3. Expired failure cannot increment budget or mutate task state.
4. Expired reconnect cannot resume.
5. Requeued task cannot be claimed by old or never-issued local token.
6. After B takes ownership, A's heartbeat/progress/fail/cancel ACKs/reconnect leave task, lease, attempts and event count unchanged.
7. Wrong-job tombstone cannot cancel a valid task.
8. Current valid lease still supports heartbeat/progress/reconnect and legitimate failure.
9. Old owner's cancel ACKs cannot cancel B; B's valid ACKs still complete cancellation.

## User reproduction

```powershell
Set-Location D:\Shopify_Workspace\Tool\ffp_tool
python scripts/audits/audit_lease_baseline.py --mutations
```

Uses the existing `ffp-local-postgres`, loopback-only binding and a generated schema per repetition, with no `public` search path. Each case resets only fixture tables in that verified test schema. At the end the harness drops that exact generated schema and checks it no longer exists. Credentials remain in memory and are not printed; no real crawler/browser/Shopify calls are made.

Expected twice:

```text
Ran 9 tests ...
OK
RUN 1: mutation tests=9, failures=0, skipped=0
RUN 2: mutation tests=9, failures=0, skipped=0
PASS: PostgreSQL mutation authority tests passed twice; Task 04 awaits user acceptance.
```

Output ordering can differ because unittest writes to stderr and the schema summary to stdout. Both schema cleanup confirmations must be present.

Task 02/03 regression commands also passed again after these runtime changes:

```powershell
python scripts/audits/audit_lease_baseline.py --expect current-lease
python scripts/audits/audit_lease_baseline.py --streaming
```

These are store-level PostgreSQL scenarios, not a new end-to-end WSS/browser test. Existing transport tests run with the full suite; live reconnect and outbox recovery will be revisited in later tasks.

## User acceptance

### Fresh verification

| Check | Result |
| --- | --- |
| New mutation suite before runtime edit | 9 cases, 6 failures |
| New mutation suite after edit | 9 passed on SQLite |
| PostgreSQL `--mutations` | 9 passed in each of two repetitions, 0 skips; schema cleanup verified |
| PostgreSQL `--expect current-lease` and `--streaming` | Both passed again |
| `npm test` | Exit 0; engine 394 tests with 12 skipped; tooling/web/gateway have 1/7/53 skips respectively; Review Image 34 passed plus extension scripts; Pinterest 14 passed |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0 |
| `git diff --check` | Passed |

General-suite skips are not coverage evidence. The focused PostgreSQL suite did run. No mock selection/composition change; `build:mock` was not rerun. Local logs are outside Git at `%TEMP%\ffp-audit04-before.log`, `%TEMP%\ffp-audit04-npm-test.log`, `%TEMP%\ffp-audit04-typecheck.log`, and `%TEMP%\ffp-audit04-build.log`.

### User checklist

- [ ] Run `--mutations` and see 9 tests pass in each repetition, no skips, and both cleanups.
- [ ] Confirm current agent operations remain valid while stale task updates do not modify state.
- [ ] Accept Task 04 and its scoped limitations.
- [ ] Authorize Task 05 separately when ready.
