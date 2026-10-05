# Task 38 — MVP fleet fault acceptance

## Status

**Accepted at the user-approved five-agent scope; not equivalent to the original 20-agent scale target.** On 2026-10-05 the user explicitly accepted five agents as sufficient for this project gate. The original specification's 20-agent target remains unchanged and is recorded as a deviation, not as a passed 20-agent test.

## Local evidence collected

On 2026-10-05, `python scripts/audits/audit_lease_baseline.py --reliability --expect current-lease` passed twice against PostgreSQL 17. Each run used a newly generated `ffp_audit01_<uuid>` schema with `public` excluded, then dropped that exact schema and verified its absence. No application schema or running project container was changed.

Both runs passed:

- 9 PostgreSQL lease/mutation-authority tests and 10 durable receipt tests, with zero skips.
- Stale lease rejection, idempotent receipt retry, and single-winner concurrent claim.
- Actual Coordinator HTTP/WebSocket transport with two in-process `DistributedCrawlerAgent` clients; lost-ACK recovery, reconnect, Coordinator recreation, durable local spool and exactly one persisted result/product.
- No recrawl during recovery; stale writer data quarantined rather than accepted.

The audit harness was adjusted to initialize the current Coordinator migrations in its isolated schema. Its expired-lease fixture also clears the retry cooldown/negative cache so it tests lease fencing rather than retry timing.

## Acceptance matrix and evidence boundary

| Required scenario | Evidence/status |
| --- | --- |
| Five-agent acceptance threshold | Accepted by the user as the Task 38 project threshold. This report contains no five-agent run transcript; automated transport evidence below remains two in-process fixture clients. |
| Original 20 agents run concurrently | **Not run.** Current transport scenario has two in-process fixture clients. |
| Randomly terminate five while crawling | **Not independently verified here.** No OS-process kill transcript was provided in this audit. |
| Coordinator/server outage and restart | Two-agent application recreation and WSS disconnect/reconnect pass; full 20-agent outage scenario **not run**. |
| STOP one job | Covered by existing focused command/service tests, not exercised in the same fleet scenario. |
| PURGE one agent | Covered by existing focused command/service tests, not exercised in the same fleet scenario. |
| Revoke one key | Covered by existing isolated authorization/key tests, not exercised in the same fleet scenario. |
| Restart one agent | Durable identity/spool reopen is covered; full fleet command-driven agent restart during the scenario **not run**. |
| Reconcile tasks, results, outbox, terminal states, history across all faults | Two-agent subset passes; fleet-wide reconciliation **not run**. |

## Scope deviation and remaining evidence

The user's five-agent threshold is accepted as the project gate, but must not be reported as verification of the original 20-agent target. The source-level integration fixture is not a five-agent operational test: it does not provide five independently running agent processes, OS-level kills, the ordered STOP/PURGE/revoke/restart operations against one shared workload, or fleet-wide before/after database and outbox reconciliation. The Task 38 checklist records user acceptance separately from machine-verified evidence.

## What is needed to finish

To close the evidence gap at the accepted project threshold, run the fault sequence against five independently running local agents and a disposable PostgreSQL database. Use fixture-only crawl work. Record agent/task/result counts, task attempts and command/audit history before and after every fault. Verify that no result is duplicated or lost, no task remains leased forever, cancelled work is never reissued, revoked credentials cannot reconnect, and local unacknowledged outbox data survives. The original 20-agent load target remains a separate future scale test. Do not point this test at production data or real Amazon/Shopify writes.

The normal three-container development stack was deliberately not restarted or modified for this audit. No push or VPS operation was performed.
