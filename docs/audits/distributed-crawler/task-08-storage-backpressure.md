# Task 08 — storage backpressure and failure-safe admission

- Baseline: `674a1e5`, working branch `cua_pro` per user instruction (exception to per-task branching).
- Original specification: **16, 30, 36** — durable local result handling, upload backlog and storage-error behavior. This is not completion of all error taxonomy or crash recovery requirements.
- User explicitly approved the thresholds below before implementation.
- Delivered in `8217bbe`. User authorized the next task through conversation; no additional manual-test log was supplied. See Task 09 for recovery admission.

## Approved policy

| Condition per agent | Action |
| --- | --- |
| Retained outbox payload reaches 1 GiB | Advertise zero capacity; do not start more work |
| Retained final/product rows reach 10,000 | Same |
| Free space is below 2 GiB | Same |
| Oldest retained result is at least 24 hours old | Warning only, no automatic deletion |
| SQLite/file I/O fails | Fail closed; latch storage fault for this agent instance |

Both pending and quarantined rows count. Bytes are the UTF-8 serialized payload bytes retained in the two outbox tables, not SQLite allocated pages or binary asset sizes. Free-space checks cover the agent database directory and project/output root; the smaller free-space reading is used. Assets on separately configured external mounts are not inventoried by this change.

The quota is an **admission threshold**, not a write rejection threshold. In-flight work may finish and persist results above it. Refusing a completed result solely because the limit was crossed would lose that result. This is not a guaranteed reservation of disk space for all in-flight outputs.

No result, quarantine entry or asset is deleted automatically. Uploading already-persisted, eligible results continues while pressure blocks new work. Normal capacity returns once all numeric thresholds are healthy. No unapproved hysteresis thresholds were introduced.

An actual storage I/O failure is latched even if a later probe succeeds. Operators must repair storage/permissions, preserve existing data, and restart the agent for a fresh initialization. Pause/resume does not clear this latch. Full restart reconciliation remains Task 09.

## Runtime changes

- `availableSlots` becomes zero under pressure, covering hello/ready/heartbeat capacity reporting.
- An assignment arriving after capacity dropped is not saved or queued. The agent sends `ready` with zero slots; the coordinator can expire/reassign that already-issued lease. No invented success or task-failure ACK is sent.
- Queued execution checks storage before dequeuing and again after batch assembly. Existing active work is not cancelled merely because quota is reached.
- Outbox database exceptions propagate and latch the fault. Subsequent result saves are rejected in that instance, preventing a swallowed earlier callback error from becoming a later successful final save.
- Completion remains downstream of successful persistence. The focused test injects a failing review-result save and verifies no `completed` event is queued.
- Existing persisted backlog is retained on a later save failure. A result that could not be written is **not** claimed durable or recoverable after a crash; the requirement here is no false success and no further admission.
- Status includes `storage` diagnostics: blocked flag, reasons, age warning, retained record/payload-byte counts and free space. Probe failure reports unavailable measurements and blocks admission.
- Dashboard/tray show a storage warning instead of claiming readiness. GUI text is covered at formatter level; a clean-machine native GUI acceptance test was not performed.

## Configuration

Optional `outbox` object in the existing private agent JSON config:

```json
{
  "outbox": {
    "maxBytes": 1073741824,
    "maxRecords": 10000,
    "minFreeBytes": 2147483648,
    "warnAgeSeconds": 86400
  }
}
```

All values must be positive integers; invalid provided values fail validation. Missing values use the approved defaults. The checked-in `config/amazon-crawler-agent.example.json` documents them; no actual local config was edited. Changing configuration requires agent restart, not a server database migration.

## Changed files

Under `src/modules/amazon-crawler/engine/`:

- `distributed/client_storage_pressure.py`: limits, measurement, reason codes and warning text.
- `distributed/client_store.py`: retained usage query and I/O failure latch; preserve successful-persistence-before-completion rule.
- `distributed/client_config.py`: parse optional validated outbox limits.
- `distributed/client_agent.py`: capacity/receiver/execution gates and status diagnostics; leave upload draining enabled.
- `distributed/client_dashboard_window.py`, `client_tray.py`: operator warnings.
- `tests/test_outbox_pressure.py`: focused quota, I/O fault, admission and upload-draining coverage.

Shared configuration example changed only to document the new agent setting. Audit docs update progress and Task 07 acceptance. No dependency, HTTP route, production container or database schema changed. No unrelated root files were staged.

## User verification

From the repository root:

```powershell
python -m unittest discover -s src/modules/amazon-crawler/engine/tests -t src/modules/amazon-crawler -p test_outbox_pressure.py
```

Expected: **`Ran 14 tests`**, **`OK`**, no skips. Tests use temporary databases, mocked disk readings and injected SQLite exceptions. They do not fill any real disk, crawl Amazon, write Shopify, or restart the real agent.

Cases cover defaults/validation; quarantine in quota; byte limit and recovery after ACK; low disk/probe failure; age-only warning; save-failure latch and incomplete assignment; uploads draining under pressure; queued execution blocked; late assignment refused; no completion after failed review save; JSON config/warning text; unreadable database status; existing backlog preserved; exact 2 GiB boundary allowed.

## Verification record

- Test-first: new suite initially failed because the pressure module did not exist; the added warning-text test also failed before its implementation.
- Focused Task 08: 14 passed, no skips.
- Task 07 regression: 13 passed, no skips.
- Task 06 regression: 14 passed, no skips.
- Full `npm test`: exit 0; engine ran 444 tests with 13 environment skips. The focused pressure suite ran without skips.
- `npm run typecheck`, `npm run build`: exit 0. `git diff --check`: passed.
- Logs outside Git: `%TEMP%\ffp-audit08-npm-test.log`, `%TEMP%\ffp-audit08-typecheck.log`, `%TEMP%\ffp-audit08-build.log`.

No mock composition changed. No PostgreSQL migration occurred; this task measures local agent storage.

## Remaining work and stop point

No rebuild, real database migration, agent restart, push or deployment was performed. Task 09 must complete reconnect/restart admission; Task 10 is the integrated reliability gate. Storage quota does not replace future retention/review tooling, filesystem reservations, external asset inventory or fleet-level scheduling.

- [ ] User verifies Task 08 and accepts the scoped behavior.
- [ ] User separately authorizes Task 09.
