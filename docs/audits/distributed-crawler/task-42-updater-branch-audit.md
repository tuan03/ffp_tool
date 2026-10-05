# Task 42 — Audit existing Agent updater branch

## Scope and baseline

- Audited `feature/tooling-add-agent-self-update` read-only against the current `cua_pro` worktree after Tasks 39–41.
- The branch head is `ed3e7fd`; updater introduction is `02f6957`, followed by UI/status and release/deployment hardening commits `1f4fcbe` and `ed3e7fd`.
- The branches have multiple merge bases and the updater branch contains unrelated merged changes. Therefore the aggregate `cua_pro...feature/...` diff is not a safe cherry-pick plan. Findings below are based on the updater-specific commits and files, not a wholesale branch merge.
- No branch switch, merge, cherry-pick, release, deployment, or source edit from the branch was performed.

## Finding

The branch contains useful updater building blocks, but it is **not safe to merge wholesale** and does not yet meet this project's accepted Task 40 DRAIN / Task 44–45 update-and-rollback contracts.

| Upstream component | Decision | Reason / adaptation needed |
| --- | --- | --- |
| `agent_release.py` semver release selection, exact GitHub URL allowlist, immutable asset names, checksum/size parsing, cached last-known-good policy and optional version pin | Reuse selectively for Task 43 after adding tests against the current Postgres-backed server composition | Good bounded policy model; review its cache age, redirects/response bounds and remove the internal `assert` assumptions while porting. Hash is integrity, not publisher signature. |
| `client_updater.py` streaming `.part` download, exact byte count, SHA-256, atomic rename and partial cleanup | Reuse selectively for Task 43 | Useful download primitive. Add disk-full/insufficient-space/Windows replacement tests and ensure an existing verified installer remains intact on failed replacement. Authenticode cannot be accepted as complete without a trusted signing certificate. |
| `scripts/agent-release-decision.mjs` + tests | Reuse/adapt for Task 43 | Monotonic semantic release/version gate and stable asset checks are useful. Align with existing root release workflow; avoid making agent releases contingent on a separate Coordinator image deployment. |
| Tray/dashboard update prompt and policy polling | Reuse only UX ideas in Task 44 | Existing implementation enables install from `updateReady = no active tasks + no result/product rows`; it does not require Task 40 `DRAINED` or server ACK of telemetry, cancel intents and quarantined records. Adapt to require DRAIN and all outbox ACKs. |
| `client_tray.py` download-then-stop-and-launch installer | Do not port as-is; replace/extend in Task 44 | It stops then launches Inno Setup but has no durable update journal, post-install self-test/ACK handoff, or robust interrupted-install recovery. Task 44 must use DRAIN first. |
| Existing tests `test_agent_release.py`, `test_agent_updater.py` | Reuse as test-design references in Tasks 43–45, port fixtures selectively | They cover policy selection, stale/unavailable policy, blocked lease admission, digest/size rejection and happy-path installer launch, but do not prove DRAIN, full outbox ACK, journal recovery, identity/data comparison, disk-full behavior, installer rollback or clean-machine operation. |
| `.github/workflows/release-agent.yml` deployment stages and `scripts/deploy-amazon-coordinator.sh` | Reject the separate-Coordinator deployment architecture; rewrite/reuse only artifact-release concepts | It builds/pushes a Coordinator image and deploys a Compose `coordinator` service with a separate Postgres service. That creates a separate runtime/database and contradicts the mandated topology: exactly `client`, `server`, `database`, with Coordinator as a child process of the existing `server` container. The deployment script also assumes an existing standalone Compose coordinator. |
| Custom GPT, review-image, and unrelated merged diffs | Exclude | Not part of Tasks 42–46 and already have independent ownership/history. |

## Required implementation sequence after this audit

1. **Task 43 — Verify release artifacts:** port policy selection and download verification into the existing three-container source/runtime. Test stable version monotonicity, exact trusted HTTPS URLs, checksum and size, partial/corrupt/oversize response cleanup, low disk and preservation of the previously verified artifact. Record Authenticode as an explicit unmet trust gate because no certificate/signer is available.
2. **Task 44 — Safe update transaction:** only offer installation after server-confirmed DRAINED (including every durable outbox ACK). Persist an update journal under the existing agent data directory; download/verify to a staging path, stop cleanly, run installer, relaunch, run Task 41 self-test, then ACK the new boot/version. On disconnect/backlog, remain DRAINING and do not install.
3. **Task 45 — Agent rollback:** retain prior installer/binary and a durable journal; if install, relaunch, or self-test fails, restore the prior version without replacing identity or deleting SQLite/outbox/config. Test failures/crashes at each boundary and ensure server only considers rollback complete after the replacement boot reports the old version healthy.
4. **Task 46 — Acceptance gate:** still pending an Authenticode certificate and clean Windows VM. Do not claim a signed, clean-machine installer or production canary until both are available and verified.

## Original specification mapping

- Distributed crawler specification: §4.6, Tasks 40, 54 (updater/security/deployment architecture audit).
- Project checklist: Task 42, dependency E5.3.

## Verification / limitations

- Read-only branch inspection: updater-specific commit summaries, file inventory, policy/downloader/tests, dashboard/tray behavior, Coordinator release API, CI workflow and deployment Compose/script.
- No code from the updater branch was executed in this audit; tests there describe coverage but are not treated as current-branch evidence.
- Authenticode and clean-machine validation remain explicitly pending; the VPS's standalone Coordinator deployment path is excluded from this project.
