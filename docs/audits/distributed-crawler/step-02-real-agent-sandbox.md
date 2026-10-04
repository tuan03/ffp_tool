# Step 02 — isolated real-agent sandbox

Date: 2026-10-04. User approved a separate local test environment and agent.
Branch remains `cua_pro` by user instruction. No production source behavior changed.

## What is running

- One real source-agent CLI subprocess (`engine.distributed.client_main --no-tray`).
- A separate Coordinator bound only to `127.0.0.1`, with HTTPS and authenticated WSS.
- A private schema in the existing `ffp-local-postgres` test database.
- Its own agent SQLite, DPAPI credential, logs and certificate below ignored
  `.runtime/auth-sandbox/<run-id>/`, protected with a current-user Windows ACL.
- TLS trust is scoped to the supervisor/agent processes using `SSL_CERT_FILE`;
  no certificate was installed globally and certificate verification remains enabled.
- The agent stays paused for admission. No real crawl or Shopify write is performed.
  The optional outbox test seeds a synthetic result and exercises the actual agent's
  restart, reconcile, authenticated upload and acknowledgement path.

The existing application containers and existing agents are not restarted. This
sandbox does not appear in the production/local application UI because it uses a
different database schema. It has no tray window or separate React frontend.

## Commands from the repository root

```powershell
python scripts/audits/local_auth_sandbox.py status
```

Expected: `state: running`, `connected: true`, a non-null `agentPid`, `paused: true`.
Keep `agentId` for comparison. `paused: true` is intentional and is not a connection error.

Run these **one at a time**, waiting a few seconds and checking status after each:

| Command suffix | Expected result |
| --- | --- |
| `restart-agent` | PID changes; agent reconnects; identity stays the same |
| `rotate` | Replacement key is stored with DPAPI; agent restarts and reconnects with the same identity |
| `test-outbox` | Synthetic pending result survives a process restart, uploads and drains to `results: 0` |
| `revoke` | Within a few seconds `connected: false`; agent logs NEED_REAUTH and exits; supervisor remains available |
| `rebind` | Operator replacement key restores connection with the same identity and existing local data |

For example:

```powershell
python scripts/audits/local_auth_sandbox.py restart-agent
python scripts/audits/local_auth_sandbox.py status
```

Advanced retention test, only after the previous outbox is empty:

1. Run `revoke`, wait until `connected: false`.
2. Run `test-outbox`; expect `results: 1`, still disconnected.
3. Run `rebind` promptly, **within the 60-second lease window**.
4. Wait for reconnect; expect the same identity and `results: 0`.

If the lease expires, retention/quarantine rather than upload is expected. Do not
delete the database or repeatedly generate more fixtures to force a green result.
An `ok: true` command reply means the action was applied, not that asynchronous
reconnection has already finished; always check `status` afterward.

Stop only this test environment:

```powershell
python scripts/audits/local_auth_sandbox.py stop
```

Stop retains its private schema and local outbox/logs for inspection; it does not
delete application data. Starting `serve` again creates a **new** isolated run,
not a restoration of a stopped Coordinator. Do not run multiple supervisors.

```powershell
python scripts/audits/local_auth_sandbox.py serve
```

The foreground `serve` command stays running in that terminal. The assistant started
the current supervisor hidden, and left it running for user acceptance.
Prerequisites: Windows, existing Python dependencies including `cryptography`, and
the loopback-published `ffp-local-postgres` container. No global credential setup needed.

## Evidence observed

- Agent connected over verified HTTPS/WSS as a separate OS process.
- Restart and rotation kept the same server-issued identity.
- Revocation closed the session and produced NEED_REAUTH in the agent log.
- A seeded result remained in the local outbox while the key was revoked.
- Rebind restored that identity and drained the retained result.
- Direct inspection of the isolated PostgreSQL schema found two durable synthetic
  results after two successful upload tests; neither required a real crawl.
- A Windows status-file reader/rename race in the new supervisor was reproduced,
  covered by `test_local_auth_sandbox.py`, and fixed with bounded replacement retries.
- `python scripts/audits/test_local_auth_sandbox.py`: passed (one focused test).
- `npm test`: passed (engine 473, 13 skipped; Review Image 34; Pinterest 14).
- `npm run typecheck`, `npm run build`: passed. Existing build warnings remain.

## Limits — not all of Step 02 is accepted

This verifies a real **source-agent process**, not a newly built/signed installer or
clean Windows machine. It does not prove new-machine DPAPI/reinstall behavior.
The rebind test here reuses the current local database, not a fresh installation.

Still pending: authenticated Crawler/Pinterest/Review Studio UI and composed-service
compatibility, legacy Pinterest namespace migration, full production-shaped Nginx/TLS
integration, and public VPS acceptance. This sandbox uses direct local Coordinator
TLS; the preceding `--proxy-auth` audit separately covers local Nginx routing.

Do not enable production auth, push/deploy, or advance to Task 20 based solely on this test.
