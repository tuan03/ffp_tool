# Task 43 — Verify Agent release manifest and installer before execution

## Result

Implemented a shared PowerShell release-policy verifier and wired the production Windows bootstrap (`scripts/install-agent.ps1`) through it. Before setup can launch, the manifest must have the supported schema, stable semantic version, bounded positive size, SHA-256, a signer thumbprint present in the operator's out-of-band pin list, the exact immutable versioned GitHub Release URL, and compatible minimum protocol/server versions. The downloaded EXE is accepted only when its exact size and digest match and Windows reports a valid Authenticode signature from the pinned signer.

The download path:

- checks available disk space before network transfer;
- streams to a unique `.part` file with a hard size bound;
- disables automatic redirects and allows only HTTPS GitHub release hosts;
- validates hash, size, and Authenticode while the file still has an `.exe` extension;
- moves the verified installer to its version-specific final name only after all checks pass;
- removes only its own partial file on failure and leaves prior versioned artifacts untouched.

The existing source-tree `update-agent.ps1` was unsafe for production because it fetched and ran a development source installer without the signed-release contract and did not wait for Task 40 DRAIN. It now fails closed before touching installed files. Tray UI likewise refuses a newer version with an explicit message until DRAIN/update/rollback are accepted. Task 44 will replace this temporary gate with the DRAIN-based signed updater.

## Original specification mapping

- Distributed crawler specification: §4.6, Tasks 23 and 40 (artifact authenticity/integrity before execution).
- Project checklist: Task 43, dependency E5.3.

## Verification

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-agent-release-policy.ps1`: PASS. Covers valid manifest parsing, version/protocol/server compatibility, exact URL rejection, low-disk preflight, interrupted transfer cleanup, wrong hash/size, invalid signature, unsigned artifact rejection through the real Windows Authenticode API, no promotion of invalid artifacts, and preservation of the previous version.
- `node --test scripts/agent-release.test.mjs scripts/agent-release-policy.test.mjs`: 6 passed, 0 failed, 0 skipped on this Windows host. Includes bootstrap fail-closed checks and legacy updater guard.
- `python -m unittest engine.tests.test_distributed.ClientTrayTests -v`: 6 passed.
- Manifest/installer checks are integrated into the initial signed installer bootstrap; no auto-upgrade is enabled yet.
- No running Compose service, database, agent, release, VPS, or GitHub state was changed.

## Limits and gates

- No production Authenticode certificate/pin was supplied. The code accepts only a valid signature whose thumbprint is independently pinned, and correctly rejects an unsigned artifact, but this environment cannot produce or verify a real trusted release signer. A real signed-release run remains an explicit Task 46 acceptance gate.
- Automated policy tests inject a valid signature result only to exercise downstream integrity/promotion behavior. They also invoke the real Windows verifier to prove an unsigned EXE is rejected. This is not evidence of a valid trusted signature.
- Windows clean-machine, online redirect-chain, disk-full-at-filesystem-write, and release publication/canary checks remain pending Task 46/operator infrastructure.
- Auto-update intentionally remains disabled until Tasks 44–45 add DRAIN, reboot journal, post-boot self-test, ACK, and rollback.
