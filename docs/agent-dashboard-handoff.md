# Windows agent dashboard handoff

Summary
- Added a light native Windows dashboard for Amazon and Pinterest tasks, task details, local activity/history, upload state, resource samples, and existing agent controls.
- Manual launch opens the window; Windows auto-start uses `--start-minimized`. X/Escape hide to tray. A second launch activates the existing window without starting a duplicate crawler.
- Work was initially isolated on `feature/tooling-add-agent-dashboard`, based on `origin/main` commit `9225756`. At the user's request, dashboard commit `54386df` was cherry-picked as `eff3c33` into `feature/main-add-agent-release` in the primary workspace `D:/Shopify_Workspace/Tool/ffp_tool`.

Changed files
- `src/modules/amazon-crawler/engine/distributed/client_dashboard_window.py`: Tkinter/ttk dashboard, task/history filters, task details, copy controls, safe Stop confirmation, compact layout, and DPI awareness.
- `src/modules/amazon-crawler/engine/distributed/client_dashboard_state.py`: bounded local summaries, per-input progress/CAPTCHA correlation, restart reconciliation, idempotent delivery state, safe errors, and retention.
- `src/modules/amazon-crawler/engine/distributed/client_activation.py`: session-local Windows activation event scoped to the agent data directory.
- `src/modules/amazon-crawler/engine/distributed/client_agent.py`: lifecycle/progress/upload hooks, true connection readiness, separate queued/running counts, full spool counts, and history failure isolation.
- `src/modules/amazon-crawler/engine/distributed/client_store.py`: payload-free upload counts and lease metadata for local dashboard reconciliation.
- `src/modules/amazon-crawler/engine/distributed/client_main.py`: additive background-start flag, second-launch activation, and compact console status without complete dashboard history.
- `src/modules/amazon-crawler/engine/distributed/client_tray.py`: window/tray lifecycle, queued UI actions, transition-only CAPTCHA notification, fallback behavior, and Tcl finalization on the UI thread.
- `src/modules/amazon-crawler/engine/tests/test_agent_dashboard.py`: focused state, storage, controls, CLI, native window, DPI, activation, and error cases. Tk tests run in a subprocess to prevent later crawler-thread GC from finalizing Tcl.
- `packaging/windows/ffp-amazon-crawler.spec`: includes dashboard and Tk/Tcl through PyInstaller hooks.
- `packaging/windows/ffp-amazon-crawler.iss`: adds `--start-minimized` only to Windows login auto-start; interactive shortcuts retain normal launch.
- `scripts/build-amazon-crawler-client.ps1`: checks Tk availability and fails explicitly on packaging failure.
- `docs/distributed-amazon-crawler.md`: documents local window behavior, controls, storage, retention, and compatibility.
- `docs/agent-dashboard-handoff.md`: implementation and verification record.

Verification
- `npm test`: PASS. Final engine suite: 331 tests, eight skips. Seven native-window cases are intentionally skipped in the parent process and executed by the subprocess wrapper; the optional PostgreSQL integration test is skipped without its database setting.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, with existing browser-externalization and bundle-size warnings.
- `npm run build:agent`: PASS; portable folder contains Tcl/Tk DLLs, data directories, and the Tkinter extension.
- Native window tests: PASS, including selection, filters, close-to-tray, Stop confirmation, unavailable history, minimum window size, and 125%/150% font scaling.
- Final packaged EXE smoke: PASS. Background launch stays hidden; a second EXE launch returns success and opens the existing window; X hides without exiting; activation reopens it; history tables coexist with legacy storage. Smoke uses an isolated data directory and an unavailable loopback coordinator, with no production crawl or writes.
- Visual inspection: three main tabs and compact window captured using Windows window capture; preview contains demo metadata only.
- `git diff --check`: PASS.
- `build:mock` was not needed: React mock runners and runtime composition were not changed.

Contract / environment / route changes
- Additive local CLI flag: `--start-minimized`. Existing `--no-tray` and `--check-config` remain supported.
- Local status adds dashboard/readiness/count fields. The existing `pendingUploads` value now counts the complete spool rather than limited upload batches.
- Adds `dashboard_tasks` and `dashboard_events` to existing local SQLite storage. Retains seven days, at most 1,000 terminal task attempts and 5,000 activity events, protecting live lease/spool work. The latest 500 events are displayed.
- No coordinator HTTP/WebSocket or protocol-version changes, TypeScript public-contract changes, routes, application environment settings, npm dependencies, or shared/root configuration edits.

Remaining TODOs or risks
- Installer compilation was not performed: Inno Setup 6 / `ISCC.exe` is unavailable. The installer source was updated; portable EXE packaging and launch were verified.
- No live Amazon/Pinterest crawl was performed for this UI task. Progress/lifecycle behavior is tested deterministically; packaged launch is tested offline.
- A CAPTCHA without an input identity is shown as a detection notice until the affected batch finishes, rather than incorrectly marking all inputs as blocked.
- Integration into the agent-release branch retained its version-aware build and installer settings alongside the additive auto-start flag/Tk checks. No merge into `main` or push was performed. The user's explicit instruction to integrate into the current primary workspace overrides the usual separate-task-branch workflow for this integration.
- The portable build uses the existing local configuration when available, otherwise the repository's safe example configuration. Use the configured `agent.json` or pass `--config` explicitly when running against your coordinator, and exit an older agent first when it uses the same data directory.

Artifacts (untracked)
- `artifacts/windows/FFPAmazonCrawlerAgent/FFPAmazonCrawlerAgent.exe`: distribute the complete surrounding portable folder.
- `artifacts/windows/dashboard-preview.png` in the original dashboard worktree: native window preview with demo task metadata.
- `.runtime/dashboard-npm-test.log`, `.runtime/dashboard-typecheck.log`, `.runtime/dashboard-web-build.log`, `.runtime/dashboard-agent-build.log`, `.runtime/dashboard-packaged-smoke.log` in the original dashboard worktree: initial verification output.

Primary workspace integration verification
- Scope: the 13 dashboard task files listed above; existing release work was preserved. No unrelated source or root configuration changes.
- `python -m unittest discover -s src/modules/amazon-crawler/engine/tests -t src/modules/amazon-crawler -p test_agent_dashboard.py`: PASS, 27 tests with seven parent-process skips; native cases execute in the subprocess wrapper.
- `npm test`: PASS, including 331 engine tests with eight documented skips and 302 gateway tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, with a bundle-size warning.
- `npm run build:agent`: PASS, rebuilt in the primary workspace.
- Offline packaged EXE smoke: PASS for background launch, second-launch activation without duplication, X hiding/reopening, and additive SQLite history.
- `git diff --check`: PASS.
- Logs: `.runtime/dashboard-integration-test.log`, `.runtime/dashboard-integration-typecheck.log`, `.runtime/dashboard-integration-build.log`, `.runtime/dashboard-integration-agent-build.log`, and `.runtime/dashboard-integration-packaged-smoke.log` in `D:/Shopify_Workspace/Tool/ffp_tool`.
- Contract/environment/route changes and remaining installer/live-crawl limitations are unchanged from the notes above.
