# Task 40 — Lossless agent DRAIN

## Result

Implemented on `cua_pro`. An operator can request DRAIN with an audited reason. The Coordinator persists desired state `DRAINING` and closes new lease admission before delivery. The agent finishes work already assigned, keeps its durable result/product/telemetry/cancellation outbox, and reports `DRAINED` only when it has no active or queued work and all outbox records have been acknowledged by the server. Quarantined upload payloads are retained and count as outstanding; they cannot be silently treated as ACKed.

If the agent loses connectivity, it remains durably `DRAINING`; it neither deletes data nor expires the drain. On reconnect it resumes delivery and can complete only after server ACKs. An operator can later issue RESUME after the drain has completed. DRAIN is intentionally distinct from PAUSE (which preserves admission intent but does not wait for backlog) and from purge (which is not invoked).

The UI exposes the DRAIN action, requires a reason, explains the no-purge/offline behavior, and shows command status. Coordinator accepts successful completion only with `drained: true` and exact integer zeros for active tasks and pending outbox. The local outbox count includes results, products, telemetry, cancellation intents, and quarantined records without double-counting quarantined uploads.

## Original specification mapping

- Distributed crawler specification: §§6, 8–9 (drain behavior and command recovery).
- Project checklist: Task 40, dependency E5.2.

## Verification

- `python -m unittest engine.tests.test_agent_commands -v`: 25 passed.
- Amazon Crawler service tests: 34 passed.
- `npm test`: exit 0; JavaScript 455 tests (402 passed, 53 skipped), crawler engine 548 tests (530 passed, 18 skipped), Review Image 34 passed, Pinterest 22 passed; tooling suites passed.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0. Existing Vite Node-module externalization and large-chunk warnings remain; no build failure.
- Focused coverage includes operator reason validation/admission closure, non-expiring DRAIN, offline state retention, ACK-gated completion, restart durability, quarantined payload fencing, and server-side rejection of premature SUCCESS.
- No Compose rebuild/restart, database migration against the running stack, push, or deployment was performed.

## Limitations

- Runtime/UI behavior has not been manually exercised with a connected physical agent in this task. Automated local tests cover the agent, Coordinator and UI client contract.
- DRAIN can remain pending indefinitely if quarantined payloads need operator attention; this is intentional lossless behavior, not an automatic cleanup condition.
