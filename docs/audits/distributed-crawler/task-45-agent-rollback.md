# Task 45 — DRAIN-gated Agent rollback

## Outcome

Implemented an audited `ROLLBACK_AGENT` command for a failed `UPDATE_AGENT`.
Rollback restores the last-known-good installation tree and SQLite snapshot,
then reports success only after the old Agent version boots, retains its identity,
has no unacknowledged outbox entries, and passes the read-only self-test.

The control plane remains DRAINED throughout. Neither update nor rollback
automatically resumes crawling.

## Safety contract

- Before installing, the Agent verifies it is DRAINED, has no active/queued
  work, has zero unacknowledged outbox records (including quarantine), and has
  a configured local Authenticode signer pin.
- It copies the current installation into a command-scoped ProgramData backup,
  omitting runtime caches/logs, rejects symlinks, hashes every file, and writes
  an atomic SHA-256 manifest. It also makes an online SQLite backup and checks
  it with `PRAGMA quick_check`.
- The updater verifies the signed release before install. If installation fails
  after the old process exits, it invokes the last-known-good rollback helper;
  if download/preflight fails, it simply relaunches the unchanged Agent.
- If the new process exits during its startup stabilization window, the updater
  invokes a hidden offline-restore mode in the packaged Agent executable to
  verify/restore SQLite first, then restores the prior installation tree.
- An update that boots but fails its self-test is durably marked FAILED and
  remains DRAINED for an explicit operator rollback.
- The server exposes rollback only for the latest failed update, with the Agent
  connected, DRAINED, idle, and its command ledger caught up. The Agent repeats
  these checks locally and verifies the backup manifest and database digest.
- Database restore preserves the pre-update snapshot, merges current command
  receipts and Agent state, and tolerates additive columns introduced by the
  failed version. Both pre-restore and failed-current database snapshots are
  retained for diagnosis/recovery.
- The rollback helper validates its fixed Program Files install root, command-
  scoped ProgramData backup, manifest digest, relative paths, sizes, file hashes,
  and reparse-point absence before replacing files.
- A successful rollback ACK is accepted only for the original version, retained
  identity, zero outbox, and passing post-rollback self-test.

## Verification

- `python -m unittest engine.tests.test_agent_commands -v` — 35 tests passed.
- The rollback integration test simulates an additive command-table schema
  change, a failed update, database restore, replacement boot, self-test, and
  server-ACK-equivalent completion while asserting identity/DRAIN/outbox remain.
- `npm run test:web` — 910 passed, 7 skipped; includes the rollback command API
  contract test.
- `npm run test:tooling` — 53 passed, 1 skipped; validates updater fail-closed
  behavior with the added rollback inputs.
- Full `npm test` — tooling, web, Gateway, engine, Review Image, and Pinterest
  suites passed; the run reported 563 engine tests, 34 Review Image tests, and
  22 Pinterest tests.
- `npm run test:engine` — rerun after the final recovery-path code: 563 passed,
  18 skipped. The rollback integration and ledger checks were then rerun once
  more after binding the command to its exact failed-update journal: 2 passed.
- `npm run typecheck` and `npm run build` — passed after the final UI change.
- PowerShell parser accepted `update-agent.ps1`, `rollback-agent.ps1`, and
  `install-agent.ps1`.

## Acceptance still pending (Task 46)

No production Authenticode certificate or clean Windows VM is available. The
rollback path has therefore been code-tested and PowerShell-parsed, but has not
been exercised against a real signed installer, an interrupted Inno Setup
replacement, or a clean-machine canary. Do not mark Task 46 accepted or publish
an installer as production-verified until those gates pass.

The first transition from pre-Task-45 Agent builds also needs special attention:
those already-installed binaries do not contain the new local snapshot/rollback
protocol. Before allowing their first remote update, validate that exact upgrade
path on the isolated Task 46 VM, or bootstrap them with a separately approved
manual signed installer. Never infer compatibility from the new-version tests.
