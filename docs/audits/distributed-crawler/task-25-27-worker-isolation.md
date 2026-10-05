# Tasks 25–27 — Worker isolation and recovery

Date: 2026-10-05
Branch: `cua_pro`
Scope: Amazon distributed crawler batch workers; no Docker/VPS rollout.

## Task 25 — Isolation and ownership decision

- `DistributedCrawlerAgent` owns WebSocket/control loops, assignment and completion queues, local SQLite state, durable result/product outbox, heartbeats, and admission decisions.
- The execution loop dispatches one compatible assignment batch at a time. For Amazon product crawl, `_run_batch` runs in an agent-owned thread and `ProcessCrawler` starts a disposable spawned process for that batch. A one-way multiprocessing pipe carries progress, deadlines, products, completions, and errors; the agent remains the authority for result spooling and network upload.
- The child process owns the Amazon crawler and its browser descendants. On Windows, cleanup calls `taskkill /PID <worker-pid> /T /F`; on POSIX, it kills only the process group created for that child. It never searches for or kills a process by executable name. A manually opened Chrome/ChatGPT process outside this worker tree is not targeted.
- A batch can contain multiple assignments. A worker crash may interrupt unfinished assignments in that batch, but already streamed products/checkpoints remain outside the process and the agent reports retryable failure for unfinished work. This is batch isolation, not one OS process per task.
- CAPTCHA remains in the existing headed-browser flow. Its browser belongs to the crawl child tree; if the watchdog must terminate that hung worker, that worker's browser is closed. No change is made to the ChatGPT session bridge/browser extension.
- Review-crawl and Pinterest assignments currently use other in-process/thread paths, not `ProcessCrawler`. This batch does not claim native-hang process isolation for those channels; they need a separate scoped design before they can receive the same guarantee.

## Tasks 26–27 — Implemented recovery policy

- Unexpected child exit, child startup failure, and watchdog deadline termination are reported to an in-memory rolling `WorkerHealth` monitor. Application-level crawl errors and operator cancellation are not treated as worker crashes.
- Five worker failures in a rolling ten-minute window mark the agent `degraded`. Admission and batch size are reduced to `ceil(configured concurrency / 2)`, with a minimum of one slot. The state returns to `healthy` as failures age out of the window. With configured concurrency 1, the policy can report degraded but cannot halve below one without pausing all work.
- Each batch gets a new child process; a failed child is terminated before the next batch is run. No persistent child is blindly restarted in a tight loop. The existing Coordinator retry/attempt policy still governs task retries.
- Worker health is sent in bounded heartbeat observability, persisted with the agent snapshot, and shown in the crawler agent card. Existing `busy`, `paused`, and `waiting_captcha` signals keep their precedence; otherwise a degraded agent reports `degraded`.
- Worker-health records are intentionally process-local rather than durable across a full agent restart. Task assignment, commands, and pending uploads retain their existing durable stores and are not cleared by the watchdog.

## Evidence and limits

- Tests cover an abruptly exited child followed by a successful fresh worker, Windows tree termination targeting only the spawned worker PID, the 5/10-minute threshold and recovery, admission reduction while preserving an existing outbox item, and bounded Coordinator telemetry persistence.
- These are source-level/local automated checks. They do not prove Windows clean-machine behavior, release packaging, Docker/VPS rollout, or native-hang isolation for Review/Pinterest execution paths.
