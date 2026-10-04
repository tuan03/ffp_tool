# Task 03 — current-lease product streaming

- Baseline: `86c0c88`, branch `cua_pro`.
- User accepted Task 02 and authorized Task 03.
- Original specification: sections 15, 19, 31; product-streaming path only.
- Status: user supplied passing PostgreSQL output and authorized Task 04. See [Task 04](task-04-lease-mutation-fencing.md) for subsequent changes; this report retains Task 03's scope.

## Change and compatibility

`CoordinatorStore.accept_product()` now checks task status (`leased`/`running`), current client, current lease ID, and a non-null future expiry under the existing task row lock, before inserting/updating a pipeline item. Historical attempt membership alone no longer grants write authority. Cancelled tasks keep their existing cancellation response.

Expired, reassigned, queued, failed, completed, or unbounded leases return `stale`; the existing HTTP route maps this to 409. Valid current uploads still return `accepted` and duplicate uploads under a valid current lease still return `duplicate`, with one pipeline item.

No new route, schema, environment setting, dependency, or deployment change. Runtime edit is limited to the Coordinator process in the server container's source. No container rebuild/restart or VPS push/deploy was performed. Four unrelated untracked files (`Nguồn`, `Nhánh`, `Trạng`, `Tài`) remain untouched.

### Explicit limits

- Duplicate ACK here requires an active valid lease. A retry after expiry/completion is rejected, even if a product already exists. Durable receipt/checksum semantics across those boundaries remain Task 05; this task does not invent an unsafe historical-lease bypass.
- Existing agent handling of upload 409 can discard local pending data. Do not deploy this partial series to real agents before outbox work and the combined reliability gate.
- Heartbeat, progress, fail, cancellation ACK and reconnect reconciliation are unchanged and need Task 04 review. The entire section 15 is not yet complete.
- No actual SEO/Shopify job was run. Assertions check whether Coordinator creates/changes the pipeline item; fixtures never perform external writes.
- Tests are controlled sequential cases, not proof of all concurrent transaction races.

## Test-first and observed result

Two new store tests failed before the runtime change (six assertions including subcases). After the fix, those tests and the existing duplicate-product test passed. The HTTP test verifies 409 for stale A, 200/accepted for current B, 200/duplicate for B retry, and 409 for stale A again.

Real PostgreSQL check, repeated twice in separate disposable schemas:

| Case | Actual |
| --- | --- |
| A expired, before reaper | `stale` |
| A after reassignment to B | `stale`; zero pipeline items, B lease unchanged |
| B streams product | `accepted` |
| B retries under current lease | `duplicate`; exactly one item |
| A tries to overwrite B's title | `stale`; stored title and client remain B's |
| Cleanup | Only generated schema removed; absence verified |

## User reproduction

```powershell
Set-Location D:\Shopify_Workspace\Tool\ffp_tool
python scripts/audits/audit_lease_baseline.py --streaming
```

Uses the existing `ffp-local-postgres` loopback connection and the updated local checkout, not code inside the running server image. Same dependencies/isolation as Task 01; schema names keep the `ffp_audit01_` harness prefix and never include `public` in the search path. No skip path or SQLite substitution.

Both repetitions should show:

```text
expired A=stale; reassigned A=stale; B=accepted; retry B=duplicate; late overwrite A=stale; pipeline items=1 (B)
```

Final output:

```text
PASS: current-lease product streaming verified twice; other mutation paths remain outside Task 03.
```

Task 02 remains reproducible with `--expect current-lease`. The no-argument mode asserts the historical Task 01 behavior and is not expected to pass after these changes.

## User acceptance

### Fresh verification

- Focused store tests: 3 passed after implementation; two new tests failed before implementation.
- HTTP streaming/final-result test: passed (temporary SQLite fixture).
- PostgreSQL `--streaming`: passed two repetitions; schema cleanup verified.
- PostgreSQL `--expect current-lease`: passed again, preserving Task 02 behavior.
- `npm test`: exit 0. General-suite skips remain and are not counted as verified PostgreSQL coverage; the dedicated PostgreSQL harness ran without skipping.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `git diff --check`: passed.
- No mock selection/composition changes; `build:mock` not rerun.

Full local logs, outside Git: `%TEMP%\ffp-audit03-npm-test.log`, `%TEMP%\ffp-audit03-typecheck.log`, `%TEMP%\ffp-audit03-build.log`.

### User checklist

- [ ] Run `--streaming`; confirm both repetitions and cleanup succeed.
- [ ] Confirm one pipeline item from B, no insertion or overwrite from A.
- [ ] Accept Task 03's scope and the remaining receipt/outbox limitations.
- [ ] Separately authorize Task 04 when ready.

Do not tick the task or start Task 04 until the user confirms.
