# Tasks 47–53 — Fleet scale and audit closeout

**Scope:** local implementation and verification on `cua_pro`. No push, release, VPS change, or application-container restart was performed. Task 46 remains explicitly deferred and is not marked passed.

## Results by task

| Task | Result | Implementation/evidence |
| --- | --- | --- |
| 47 — Groups and scoped controls | Passed local QA | Persisted agent groups on identity/key records; key rotation preserves group and capability rights. Jobs can set `allowedAgentGroup`; lease selection enforces it. Bulk PAUSE/RESUME/DRAIN requires an explicit group or an explicit `allAgents` scope and records the reason/filters in the operator audit. Tests cover affinity, validation, operator authorization, key rights, and that another group receives no command. |
| 48 — Scheduler health/capacity/fairness | Passed local QA | Observability reports queue age/backlog, active/available capacity, utilization, over-capacity agents, completions by agent and spread. Runtime reports whether each connected agent has completed reconciliation and is ready for work. New job creation wakes ready agents instead of waiting for a future heartbeat. Lease selection now locks only the individual task being leased and balances active/capacity ratios within a matching group/capability cohort. Five-process scale results below show no starvation and no capacity overflow. |
| 49 — Adaptive concurrency | Passed local QA | CPU/RSS sampling and quota/resource-pressure hysteresis are wired into agent health. Three consecutive high samples degrade and cap effective concurrency at half the configured value; five healthy samples recover. Quota/rate failures apply bounded pressure. Focused worker-health and observability tests pass. |
| 50 — Fleet circuit breaker | Passed local QA | PostgreSQL-backed CLOSED/OPEN/HALF_OPEN state; five parser failures within five minutes open the breaker for 60 seconds; only one probe is allowed after cooldown. Probe failure reopens, success closes. Operator reset is authenticated, reason-required and audited. Admin admission STOP remains authoritative. Four dedicated breaker tests pass. |
| 51 — Batch result delivery | Passed local QA | Added `PUT /api/v1/worker/results/batch`: 1–25 results, 50 MiB compressed and decompressed request limits, with a separate durable receipt per result. Partial success does not roll back successful siblings; retry returns duplicate receipts; changed payload returns conflict. Agents ACK/delete only each matching accepted/duplicate outbox record; omitted/transient receipts stay retryable, invalid/stale/conflicting records are quarantined. Three focused API/outbox tests pass. |
| 52 — Load/scale | Passed at the tested local scope | Four incremental runs against isolated PostgreSQL schemas and five independent `DistributedCrawlerAgent` OS processes. Each process used a deterministic fake crawler; no Amazon, Shopify, or production data/API was touched. Every run ended with all task results persisted, zero queued/active work, and zero over-capacity agents. |
| 53 — Spec reconciliation | Reconciliation recorded; overall audit is not a release sign-off | This report and the checklist map verified work, explicit deferrals, and remaining acceptance gates. Task 46 is user-deferred, not passed. Existing Tasks 14–19 still await their listed user/public acceptance checks. The checklist marks only the Tasks 47–53 work and reconciliation complete. |

## Task 52 measurements

Runs were sequential, each in a newly created and subsequently removed PostgreSQL audit schema. Five agents each had configured capacity two (ten aggregate slots). Latency is measured from persisted lease start to completed attempt, including fixture work and local transport/database overhead. Per-agent counts demonstrate scheduler distribution; the final metrics snapshot had queue and active counts at zero.

| Tasks | Elapsed | Throughput | p50 | p95 | p99 | Per-agent completions | Final queued / active / over-capacity |
| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 25 | 3.59 s | 6.97/s | 1,054 ms | 2,092 ms | 2,152 ms | 5 / 5 / 5 / 5 / 5 | 0 / 0 / 0 |
| 50 | 7.01 s | 7.13/s | 1,069 ms | 1,918 ms | 1,982 ms | 11 / 10 / 10 / 9 / 10 | 0 / 0 / 0 |
| 100 | 14.39 s | 6.95/s | 1,075 ms | 2,124 ms | 2,190 ms | 21 / 17 / 22 / 21 / 19 | 0 / 0 / 0 |
| 200 | 30.25 s | 6.61/s | 1,085 ms | 2,161 ms | 2,217 ms | 42 / 39 / 38 / 37 / 44 | 0 / 0 / 0 |

Observed limit: the Coordinator accepts at most 200 inputs in one crawl job; the audit refuses larger workloads rather than bypassing the application contract. The load harness also records PostgreSQL server version/schema size and per-agent peak RSS/CPU in its JSON output. These are local measurements, not a VPS capacity forecast. No claim is made for 500 agents, the original 20-agent target, multi-hour soak, or production traffic. Task 38's kill/revoke/STOP/PURGE fault sequence remains distinct and was not covered by this steady-state scale test.

Re-run from repository root (PowerShell):

```powershell
python scripts/audits/audit_fleet_scale.py
$env:FFP_SCALE_AUDIT_TASKS = '25'; python scripts/audits/audit_fleet_scale.py
$env:FFP_SCALE_AUDIT_TASKS = '50'; python scripts/audits/audit_fleet_scale.py
$env:FFP_SCALE_AUDIT_TASKS = '200'; python scripts/audits/audit_fleet_scale.py
Remove-Item Env:FFP_SCALE_AUDIT_TASKS -ErrorAction SilentlyContinue
```

Each run discovers the loopback-only local PostgreSQL container, creates a uniquely named `ffp_audit01_<uuid>` schema, starts a loopback Coordinator and five agent processes, verifies result/task counts, shuts down only its own processes, drops that schema, and verifies that schema is absent. The harness requires local Docker PostgreSQL; it does not start, stop, or modify the application's Compose stack.

## Verification

- `npm test`: **pass after final fixes**; see final command output at handoff. The suite reports optional environment-dependent skips; no test failures.
- `npm run typecheck`: pass.
- `npm run build`: pass. Vite prints existing browser externalization and large-chunk warnings; build exits successfully.
- `git diff --check`: pass; Git reports only the repository's LF-to-CRLF working-copy warnings.
- `python scripts/audits/audit_fleet_scale.py` at 25/50/100/200: each workload passed and verified its own PostgreSQL schema removal.

## Remaining audit gates / deviations

- **Task 46:** explicitly deferred by the user on 2026-10-05 because a signed clean-machine installer is not currently needed. No Authenticode signature, clean Windows VM, canary, or uninstall acceptance was fabricated. The Task 46 checkbox remains open; Tasks 47–53 proceeded by explicit user instruction despite the checklist's former sequencing dependency.
- **Tasks 14–19:** checklist acceptance remains open, including public test URL and operator acceptance. Existing local auth test evidence is not promoted to public HTTPS/production acceptance.
- **Task 38:** five-agent normal-load evidence is now available, but the ordered five-agent fault scenario (kill/restart agents, Coordinator outage, STOP/PURGE/revoke, and full outbox/history reconciliation) was not run here. It remains separate from Task 52.
- **Scale boundary:** 200 fixture tasks/job and a short run duration only. No original 20-agent run, 500-agent claim, prolonged soak, VPS resource limit, or production write was tested.
- **Schema migration:** migration versions 13 and 14 add group identity and breaker state. Fresh isolated PostgreSQL migration/load was exercised; no existing application database migration was run because no app restart/deploy was in scope.
- **Git:** all task changes remain local and uncommitted on `cua_pro`; no push/deploy was performed. Pre-existing unrelated untracked files were preserved.
