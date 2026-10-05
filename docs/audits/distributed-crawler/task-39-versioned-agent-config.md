# Task 39 — Versioned agent runtime configuration

## Result

Implemented the Task 39 config contract on `cua_pro`. Operators can submit a secret-free runtime configuration for one connected agent. The Coordinator validates it, persists the desired config and monotonically increasing version in PostgreSQL, and marks it applied only after an ACK with the exact version. The agent validates and commits config/version together to its existing SQLite `agent_state` before applying the values. Invalid configs and mismatched ACKs leave the last-known-good applied config unchanged.

Runtime fields are concurrency, crawler limits, heartbeat interval, client-offline threshold, and lease duration. Server-side timeout relationships are enforced (offline ≥ three heartbeats; lease ≥ twice offline). Proxy credentials, Agent Keys, local paths, and other secrets are not part of this contract. Heartbeat/offline/lease values are used by the agent/Coordinator; lower concurrency or crawler limits affect subsequent admission/work, not already running tasks.

## Files

- `src/modules/amazon-crawler/engine/distributed/agent_runtime_config.py`: strict, secret-free runtime config model and bounds.
- `coordinator_models.py`, `coordinator_migrations.py`: additive migration v12 for desired/applied JSON config and versions.
- `agent_command_ledger.py`, `coordinator_server.py`, `coordinator_store.py`: durable `RELOAD_CONFIG`, exact-version ACK, WSS configuration values and per-agent config-version lookup.
- `client_store.py`, `client_agent.py`, `protocol.py`: atomic SQLite persistence, runtime apply, hello/heartbeat settings.
- `src/modules/amazon-crawler/types.ts`, `index.ts`, `service.ts`, `ui/AmazonCrawlerPage.tsx`: public typed contract, command client, version display and operator form.
- Focused Python/TypeScript tests and `scripts/audits/audit_lease_baseline.py --agent-config` PostgreSQL harness.

## Verification

- Python focused suite: 52 tests passed.
- Full crawler engine suite: 542 tests passed, 17 skipped.
- PostgreSQL isolated-schema audit: `python scripts/audits/audit_lease_baseline.py --agent-config` — two runs passed; each run created and removed only its own schema. Verified exact-version ACK and last-known-good preservation.
- PostgreSQL lease regression smoke: `python scripts/audits/audit_lease_baseline.py --streaming` — two isolated runs passed; this additionally exercised migration startup, but does not substitute for the config-specific PG audit above.
- TypeScript crawler service tests: 33 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed. Existing Vite externalized Node-module and large-chunk warnings remain unrelated.
- `git diff --check`: passed.

The first full test run exposed regressions in SQLite UTC timestamp comparison and an old recovery fixture still changing the pre-versioned config field. Both were corrected; the subsequent full engine suite passed.

## Runtime/deployment

No Compose rebuild/restart, agent restart, deployment, push, or release was performed. The additive PostgreSQL migration was exercised only in disposable audit schemas; application databases were not migrated.

## Remaining gates

- Runtime UI exercise with a real enrolled agent has not been performed.
- Signed installer, clean Windows machine, and updater acceptance remain separate Task 42–46 gates.
