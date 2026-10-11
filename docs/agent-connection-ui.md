# Windows Agent connection UI

Normal Windows startup presents a connection form before starting the worker.
It accepts an HTTP(S) server origin, display name and 1–16 concurrent inputs.
Fresh packages suggest one concurrent input. Existing configuration values are
preserved. Auto-connect is opt-in; no completed connection is claimed until the
existing worker protocol receives and reconciles `hello_ack`.

Preferences are atomically saved to `%LOCALAPPDATA%/FFP Amazon Crawler/connection.json`.
A stable per-server copy lives in `connections/<server-scope>.json`. Each running
agent binds its restart/update configuration to that copy, so selecting another
server does not redirect an existing agent's updater or reconnect flow.
A packaged agent uses that user-scoped file before its adjacent `agent.json`.
On first use, it imports portable configuration without modifying the original.
Explicit `--config`, console mode and update/rollback/installer checks remain supported.
Explicit `--config ... --start-minimized` remains a background launch, so an updater
can reconnect the safely paused agent without interrupting its recovery flow.
`AMAZON_COORDINATOR_URL` continues to override the selected origin and is disclosed
in the form. Proxy and relative data paths retain their original absolute location.

Advanced settings edit thread limits, browser limits, headless mode and an optional
proxy configuration file. Server-managed settings can override these limits; the
dashboard distinguishes selected concurrency from applied concurrency. Existing
server configuration versions are not reset by local edits.

Agent Key enrollment requires HTTPS. Keys entered in the form use the existing
Windows user-scoped DPAPI credential store and are never written to JSON/logs.
Leaving the key blank reuses an enrolled credential for the same server.

**Disconnect / Settings** pauses admission on the worker event loop, then checks
active tasks, pending uploads/cancellations, recovering assignments and storage
health. Busy agents remain connected and display a reason; no task/outbox is deleted.
Idle agents stop before reopening the form. Changing server selects that server's
existing scoped data/identity instead of sharing the previous custom data directory.
Quarantined uploads remain in their old server's store; they do not block an otherwise
safe disconnect. A persisted pause is preserved after reconnecting.

The dashboard has Work, History and Settings tabs, grouped metrics and on-demand
task details. Closing its window still hides it to the system tray. Destructive
cleanup and update actions are placed under a secondary menu and retain safeguards.

Release artifacts need a fresh Windows build. This change does not publish a release
or deploy the Coordinator, and does not modify an agent already running on a user's machine.
