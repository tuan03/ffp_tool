# Task 44 — DRAIN-based UPDATE_AGENT

## Result

Added an operator-initiated Windows Agent update path. The Coordinator accepts
`UPDATE_AGENT` only after a successful DRAIN, with desired/applied state both
`DRAINED` and the command ledger fully caught up; it also checks the Agent is
connected and has no active execution. The Agent independently rechecks its
local DRAIN state, active/queued work, every outbox category (including
quarantined records), and an out-of-band signer pin before it records a durable
update journal or launches PowerShell.

The updater uses the Task 43 policy to validate the latest release manifest,
compatibility, exact target version, artifact size/hash and pinned
Authenticode signer before setup. It waits for the drained Agent process to
exit, runs the signed installer in-place, then launches the replacement with
the existing ProgramData config. Identity, SQLite state, credentials, proxy
profiles and outbox are not copied, migrated, purged or recreated by this
flow; they remain at their existing durable paths.

The journal is stored transactionally in the Agent's existing SQLite
`agent_state`. On reconnect, the new process verifies the target version,
identity, zero outbox and a PASS read-only self-test before returning SUCCESS.
The Coordinator independently validates these success fields before recording
the ACK. A failed/mismatched boot never resumes task admission; the Agent stays
DRAINED for operator recovery. The tray directs operators to the dashboard's
DRAIN-then-update controls.

## Verification

- Focused Python command/config tests: 40 passed. Covers server-side drain
  eligibility, outbox gate, journal restart behavior, post-boot ACK invariants,
  and trusted thumbprint parsing.
- Amazon Crawler web service tests: 36 passed, including the command payload.
- Windows PowerShell parser: update, release-policy and bootstrap scripts parse.
- `npm run typecheck`: PASS.
- `npm run build`: PASS; only existing Node built-in externalization and large
  bundle warnings.
- `npm run test:tooling`: 53 passed, 1 environment-gated skip.
- Full `npm test`: PASS (tooling 53 passed/1 skipped; web 909 passed/7 skipped;
  Gateway 402 passed/53 skipped; crawler engine 561 passed/18 skipped;
  Review Image 34 passed; Pinterest 22 passed). Focused update tests and
  typecheck were rerun after final safety-gate refinements.
- `ISCC.exe` is not installed on this workstation, so the Inno Setup installer
  was not compiled here.
- No Agent process, installer, Compose service, database, release, VPS or
  GitHub state was changed.

## Limits

- This host has no real Authenticode certificate and no clean Windows VM. The
  end-to-end updater test injects a controlled launcher/version and does not
  prove a signed setup can replace a real installation. Real signer and
  clean-machine/canary acceptance remain Task 46 gates.
- A local `trustedSignerThumbprints` array must be present in
  `%ProgramData%\FFP Amazon Crawler\agent.json`; bootstrap installation writes
  the out-of-band pin supplied to it. A missing pin fails closed before
  download/installation.
- If setup fails before boot, the Agent remains DRAINED. Starting the previous
  installed executable replays the durable update command, records failure,
  and does not resume crawling. Automatic binary rollback is Task 45.
