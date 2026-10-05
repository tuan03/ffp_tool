# Task 38 — MVP 20-agent fault acceptance

## Status

**Not accepted yet.** The full acceptance scenario in sections 53/58 of the original specification has not been demonstrated. Per the checklist, smaller tests cannot be substituted for the 20-agent fleet scenario, so Task 38 remains unchecked.

## Local evidence collected

On 2026-10-05, `python scripts/audits/audit_lease_baseline.py --reliability --expect current-lease` passed twice against PostgreSQL 17. Each run used a newly generated `ffp_audit01_<uuid>` schema with `public` excluded, then dropped that exact schema and verified its absence. No application schema or running project container was changed.

Both runs passed:

- 9 PostgreSQL lease/mutation-authority tests and 10 durable receipt tests, with zero skips.
- Stale lease rejection, idempotent receipt retry, and single-winner concurrent claim.
- Actual Coordinator HTTP/WebSocket transport with two in-process `DistributedCrawlerAgent` clients; lost-ACK recovery, reconnect, Coordinator recreation, durable local spool and exactly one persisted result/product.
- No recrawl during recovery; stale writer data quarantined rather than accepted.

The audit harness was adjusted to initialize the current Coordinator migrations in its isolated schema. Its expired-lease fixture also clears the retry cooldown/negative cache so it tests lease fencing rather than retry timing.

## Acceptance matrix

| Required scenario | Evidence/status |
| --- | --- |
| 20 agents run concurrently | **Not run.** Current transport scenario has two in-process fixture clients. |
| Randomly terminate five while crawling | **Not run.** Existing test uses a failing crawl sentinel and does not kill five OS processes mid-work. |
| Coordinator/server outage and restart | Two-agent application recreation and WSS disconnect/reconnect pass; full 20-agent outage scenario **not run**. |
| STOP one job | Covered by existing focused command/service tests, not exercised in the same fleet scenario. |
| PURGE one agent | Covered by existing focused command/service tests, not exercised in the same fleet scenario. |
| Revoke one key | Covered by existing isolated authorization/key tests, not exercised in the same fleet scenario. |
| Restart one agent | Durable identity/spool reopen is covered; full fleet command-driven agent restart during the scenario **not run**. |
| Reconcile tasks, results, outbox, terminal states, history across all faults | Two-agent subset passes; fleet-wide reconciliation **not run**. |

## Why this is not a pass

The passing audit is a source-level integration fixture, not a 20-agent operational test: it does not provide 20 independently running agent processes, OS-level kills, the ordered STOP/PURGE/revoke/restart operations against one shared workload, or a fleet-wide before/after database and outbox reconciliation. Marking Task 38 complete from these results would overstate the evidence.

## What is needed to finish

Run the exact fault sequence from the original Definition of Done against a disposable local deployment with 20 independently running agent processes (or 20 Windows VMs if process isolation is part of the intended load). Use fixture-only crawl work and a disposable PostgreSQL database. Record agent/task/result counts, task attempts and command/audit history before and after every fault. Verify that no result is duplicated or lost, no task remains leased forever, cancelled work is never reissued, revoked credentials cannot reconnect, and local unacknowledged outbox data survives. Do not point this test at production data or real Amazon/Shopify writes.

The normal three-container development stack was deliberately not restarted or modified for this audit. No push or VPS operation was performed.
