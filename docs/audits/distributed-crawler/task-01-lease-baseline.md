# Task 01 — PostgreSQL lease baseline

> Historical report: the user verified Task 01 and authorized Task 02. Its first-result-wins observations refer to the pre-fix baseline. On the Task 02 checkout, run the harness with `--expect current-lease`; see [Task 02](task-02-final-result-fencing.md). The original no-argument command intentionally asserts the old behavior and is no longer expected to pass after the fix.

## Scope and status

- Baseline: `1c8d5a9`, branch `cua_pro`.
- Original specification: sections 14–15; characterization only, not implementation of current-lease fencing.
- User approved using the existing local PostgreSQL container with a separate disposable schema.
- Status: focused characterization passed; **awaiting user verification and acceptance**. Task 02 has not started.
- Changed files: an isolated audit harness, this report, and checklist status. No application/runtime behavior changed.

## Environment and isolation

The harness reads connection details from the existing `ffp-local-postgres` container in memory. It requires its existing `127.0.0.1` port binding, uses the installed local Python/SQLAlchemy/psycopg dependencies, and never prints credentials.

Each repetition creates a unique `ffp_audit01_<uuid>` schema. The connection search path contains only that schema, not `public`. SQLAlchemy creates fixture tables there. The harness uses CoordinatorStore from the local checkout, not the older code inside a running server image.

No container was created/restarted, no volume was mounted or removed, and no application table was targeted. No real Amazon/Shopify request was made. Agent A/B are store-level fixtures, not real browser agents or WSS connections.

Cleanup drops only the exact schema created by that repetition and verifies its absence. This intentionally removes the disposable fixture records; their useful evidence is retained below. If the Python process is force-killed before its `finally` block, cleanup may not run: inspect the printed exact schema before any manual cleanup, never use broad schema deletion.

## Reproduce on this workstation

From PowerShell:

```powershell
Set-Location D:\Shopify_Workspace\Tool\ffp_tool
python scripts/audits/audit_lease_baseline.py
```

Prerequisites: Docker Desktop running, the existing `ffp-local-postgres` container running with its loopback binding, Python with the repository's Coordinator dependencies. The command does not start missing containers or install dependencies. It fails rather than silently running SQLite or skipping the test.

This script characterizes the old behavior deliberately. Once Task 02 changes that behavior, do not keep requiring first-result-wins forever: revise/retire the baseline assertion as part of the approved change while retaining this report as historical evidence.

## Observed results

| Step | Expected existing baseline | Actual, both repetitions |
| --- | --- | --- |
| A leases fixture task | A owns lease A | Confirmed |
| Set expiry into past; run reaper | One task requeued | Confirmed |
| B leases the task | Same task, distinct lease B; current owner B | Confirmed |
| A sends final result late | Old implementation accepts A | `accepted` |
| B sends final result | Old implementation calls B duplicate | `duplicate` |
| Inspect durable task/result | One result from A; task completed using A's lease | Confirmed |
| Inspect attempt history | Two attempts retained | A `completed`; B still `leased` |
| Cleanup | Own schema absent | Confirmed |

Lease expiry is changed only on the fixture task, without long sleeps or changes to application timeouts. Payloads contain empty product arrays and an A/B marker; product streaming is intentionally not exercised in Task 01.

Successful output, omitting random schema names:

```text
backend=postgresql; search_path excludes public
RUN 1: A expired -> requeued -> B owns a different lease
RUN 1: late A=accepted; current B=duplicate
RUN 1: task=completed, stored result=A, count=1; attempts A=completed B=leased
RUN 1: own test schema removed and absence verified
backend=postgresql; search_path excludes public
RUN 2: A expired -> requeued -> B owns a different lease
RUN 2: late A=accepted; current B=duplicate
RUN 2: task=completed, stored result=A, count=1; attempts A=completed B=leased
RUN 2: own test schema removed and absence verified
PASS: baseline reproduced twice; spec current-lease-only remains NOT MET. No runtime fix applied.
```

The first development run of the harness failed with `KeyError` because it read `requeued` rather than the existing return field `requeuedTasks`. Its schema was cleaned successfully. Only the harness was corrected; the subsequent full two-repetition run exited 0.

## Interpretation and limits

The baseline audit passes because it reproduces and records actual behavior. **Specification section 15 is not satisfied by that behavior**: the old lease wins even after a new lease is assigned. Task 02 must change the final-result contract after user approval of D2; Tasks 03–04 cover other mutation paths, and Task 10 covers combined reliability.

The remaining `leased` attempt B is an observed baseline inconsistency to account for when changing completion/attempt semantics, not something fixed in this task.

Not verified here: simultaneous transaction races, HTTP/WSS authentication, streaming products, agent SQLite recovery, browser execution, VPS state, or complete historical migration. Two sequential repetitions are repeatability evidence, not a load/soak test.

## Fresh verification commands

| Command | Result |
| --- | --- |
| `python scripts/audits/audit_lease_baseline.py` | Exit 0; two repetitions per invocation; run successfully again before handoff |
| `npm test` | Exit 0; tooling 51 pass/1 skip, web 887 pass/7 skip, gateway 402 pass/53 skip; engine 379 run/12 skip; Review Image 34 pass plus extension scripts; Pinterest 14 pass |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0; bundle-size warning remains |
| `git diff --check` | Passed |

Skipped general-suite tests are not evidence of coverage. The dedicated PostgreSQL Task 01 harness did run against PostgreSQL and has no skip path. No mock/runtime code changed, so `build:mock` was not rerun. Local full logs: `%TEMP%\ffp-audit01-npm-test.log`, `%TEMP%\ffp-audit01-typecheck.log`, `%TEMP%\ffp-audit01-build.log`; they are not committed.

## User acceptance checklist

- [ ] Run the command above or review its live demonstration.
- [ ] Confirm both repetitions report `late A=accepted; current B=duplicate`.
- [ ] Confirm both report schema cleanup and the final PASS statement.
- [ ] Understand that PASS describes baseline characterization, not compliance with the new lease policy.
- [ ] Explicitly accept Task 01.
- [ ] Separately approve D2/current-lease-only and authorize Task 02 when ready.

Do not mark original sections 14–15 fully complete or begin Task 02 based only on the automated PASS.
