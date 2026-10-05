# Task 46 — Clean Windows installer and canary acceptance runbook

## Current gate

**Not accepted / not run.** The project currently has neither a production
Authenticode signing certificate nor a clean Windows VM. This document makes
the acceptance repeatable once both are provided; it is not evidence that a
signed release or canary has passed.

Required before execution:

1. A trusted code-signing certificate and independently verified signer
thumbprint, provisioned only to the release-signing environment. Never commit
or share the private key/password in chat.
2. A disposable Windows x64 VM with a clean snapshot, no Git, Python, Node,
browser automation runtime, or previous FFP Agent installation.
3. A test Coordinator URL using HTTPS/WSS, test credentials/store, and a
non-production crawler task fixture.
4. An approved signed Agent release with `latest.json`, installer, SHA-256,
size, protocol/server compatibility, signer thumbprint, and immutable release
URL. Verify the release signatures and published checksums out of band.

## Test sequence

### A. Artifact and clean-machine install

1. Restore the pristine VM snapshot; record Windows version, architecture,
   free disk, and absence of the tools listed above.
2. Download the bootstrap over HTTPS. Verify the installer is signed by the
   approved signer and matches the manifest size/SHA-256 before execution.
3. Run the one-line installer with the HTTPS test Coordinator URL, display
   name, and short-lived enrollment token. Confirm it fails closed for HTTP,
   placeholder URLs, invalid hash, untrusted signer, and insufficient disk.
4. Confirm install/autostart is idempotent, exactly one Agent process exists,
   and persistent identity, configuration, browser/proxy profile, and SQLite
   files are under the documented ProgramData directory with restricted ACLs.
5. Confirm the server reports the expected Agent connected over WSS; run the
   read-only self-test and a small approved fixture job.

### B. Update and rollback boundaries

1. DRAIN the fixture Agent and wait until the Coordinator confirms zero active
   tasks and server-ACKed outbox. Confirm no update is offered before this.
2. Update to the approved signed version. Verify manifest/signature/hash,
   install, reconnect, identity retention, zero outbox, self-test PASS, and
   server ACK. Confirm state remains DRAINED.
3. On a disposable clone only, exercise each failure boundary: invalid
   signature/hash; interrupted download; installer non-zero/partial replacement;
   missing target executable; process exit during first boot; self-test failure.
   Verify that pre-install failures relaunch unchanged binaries and post-install
   failures retain DRAIN and expose an audited rollback action.
4. Invoke `ROLLBACK_AGENT` only after the latest update is FAILED. Verify backup
   hashes before replacement, previous version reconnects, identity and
   configuration/profiles are retained, database passes `quick_check`, outbox
   remains empty, self-test passes, and the Coordinator records SUCCESS.
5. Restart the VM and verify autostart/reconnect and DRAIN preservation. Test
   uninstall separately; verify the installer does not silently delete
   ProgramData identity, outbox, configuration, or profiles.

### C. Canary and stop/rollback criteria

1. Start with one explicitly selected test Agent and a maintenance window.
   Keep the remaining fleet pinned to the previous version.
2. Monitor update command status, connected state, version, DRAIN state,
   active-task/outbox counts, self-test, Windows Event Log, and updater logs.
3. Stop rollout on any signature/hash mismatch, identity change, non-zero
   outbox, unexpected task admission, crash loop, self-test failure, or failure
   to reconnect within the agreed timeout. Do not force-resume or delete local
   state to clear a failed rollout.
4. Roll back the canary and verify all Task 45 invariants before proceeding to
   another Agent. Obtain operator approval before increasing rollout size.

## Evidence required to mark Task 46 complete

- Release ID/commit, manifest and artifact SHA-256/size, signer thumbprint, and
  signature verification output (no private key material).
- Clean VM image/version and preflight record.
- Install, update, injected-failure, rollback, restart, and uninstall logs with
  credentials/tokens redacted.
- Coordinator command history proving DRAIN, server ACK, update/rollback result,
  identity retention, zero outbox, passing self-tests, and no automatic resume.
- Canary scope, observation window, stop/rollback decision, and explicit owner
  approval for any wider rollout.

Until that evidence exists, Task 46 remains open and no production rollout or
installer release should be described as clean-machine verified.
