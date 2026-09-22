# Distributed Amazon crawler

The coordinator temporarily stores jobs and results; it never crawls Amazon. Windows agents connect outbound over WebSocket, lease one Amazon input at a time, crawl locally with the existing HTTP/Playwright fallback, and upload each completed input immediately. Results waiting for a connection are persisted in SQLite WAL on the client.

## Run the coordinator locally

For the current single-machine demo, keep `serverUrl` as `http://127.0.0.1:8766` in the ignored `config/amazon-crawler-agent.json`, then run:

```powershell
npm run dev
```

This starts the React UI and coordinator together. The `/amazon-crawler` page now submits jobs only through the coordinator; it does not run the crawler inside the web/server process. Start the portable agent separately and wait until the client panel reports it as online before submitting URLs. The portable build includes `agent.json` beside the executable, so it can also be started by double-clicking `FFPAmazonCrawlerAgent.exe`:

```powershell
.\artifacts\windows\FFPAmazonCrawlerAgent\FFPAmazonCrawlerAgent.exe `
  --config .\config\amazon-crawler-agent.json `
  --project-root .
```

SQLite at `.runtime/coordinator.sqlite3` is used automatically for this local test. PostgreSQL remains the production target on the VPS.

Completed product raw payloads are discarded as soon as Shopify confirms the sync. Normalized UI/export results remain available for 60 minutes after the whole job reaches a terminal state, then the coordinator deletes the job and its task, result, event, error, and idempotency history. Set `AMAZON_COORDINATOR_JOB_RETENTION_MINUTES` to change this window. The minimal `sourceKey` to Shopify product mapping is retained so a later crawl updates the existing Shopify product instead of creating a duplicate.

PostgreSQL is the production database. Copy `deploy/amazon-crawler-coordinator/.env.example` to `.env` in that directory, replace the database password and CORS origin, then run:

```powershell
docker compose --env-file deploy/amazon-crawler-coordinator/.env `
  -f deploy/amazon-crawler-coordinator/docker-compose.yml up --build -d
```

Put an HTTPS reverse proxy in front of `127.0.0.1:8766`. V1 intentionally has no authentication, so the coordinator must not be exposed directly to the public internet; restrict inbound IPs/firewall rules to the application server and known client networks wherever possible.

For development without Docker:

```powershell
$env:AMAZON_COORDINATOR_DATABASE_URL = "postgresql+psycopg://user:password@localhost:5432/ffp_crawler"
npm run dev:coordinator
```

## Run a client in development

Copy `config/amazon-crawler-agent.example.json` to the ignored `config/amazon-crawler-agent.json`, set `serverUrl`, then run:

```powershell
npm run dev:agent
```

The tray tooltip shows connection state, active tasks and pending uploads. A notification is emitted only when a task first enters manual CAPTCHA mode. Closing the terminal is not required for the installed version; the installer registers per-user auto-start at Windows login.

The authoritative readiness check is the **Crawler clients** panel in the web UI, or `GET /api/v1/clients`. A client is ready only when `isConnected` is `true` and its status is `online`, `busy`, or `waiting_captcha`. An old database row alone is not treated as an active connection.

## Build the Windows client

For a portable Windows build, run:

```powershell
npm run build:agent
```

The executable is written to `artifacts/windows/FFPAmazonCrawlerAgent/FFPAmazonCrawlerAgent.exe`; distribute the whole `FFPAmazonCrawlerAgent` folder because Chromium and the embedded runtime sit beside the EXE. This output is separate from Vite's `dist/`, so rebuilding the web UI does not delete the agent. To create an installer, install Inno Setup 6 so `ISCC.exe` is available on `PATH`, then run `npm run build:agent:installer`. The installer asks for the coordinator URL, writes `%PROGRAMDATA%\FFP Amazon Crawler\agent.json`, and preserves that data on uninstall.

Proxy configuration can be placed at `%PROGRAMDATA%\FFP Amazon Crawler\config\amazon-crawler-profiles.json`, or its path can be supplied through `AMAZON_CRAWLER_PROFILE_CONFIG`.

## API summary

- `POST /api/v1/crawl-jobs`: `{ "urls": [...], ...crawlerSettings }`
- `GET /api/v1/crawl-jobs` and `GET /api/v1/crawl-jobs/{jobId}`
- `GET /api/v1/crawl-jobs/{jobId}/results`
- `GET /api/v1/crawl-jobs/{jobId}/export`
- `GET /api/v1/crawl-jobs/{jobId}/events`: server-sent progress events
- `POST /api/v1/crawl-jobs/{jobId}/cancel`
- `POST /api/v1/crawl-jobs/{jobId}/retry-failed`
- `GET /api/v1/clients`
- `DELETE /api/v1/clients/cache`: clears Amazon family cache on every connected client and aggregates acknowledgements
- `WebSocket /api/v1/worker/connect`: worker lease and heartbeat protocol

Heartbeat is sent every 10 seconds. A client becomes offline after 30 seconds and an unrenewed task lease is requeued after 60 seconds. Disconnects do not consume a crawl retry; crawler failures become terminal after three attempts. If stale and current clients both finish a requeued task, the first valid result wins and later uploads are acknowledged as duplicates.

Set `TEST_AMAZON_COORDINATOR_DATABASE_URL` to an isolated PostgreSQL test database before `npm test` to run the PostgreSQL persistence/lease integration test. The test creates and drops its own temporary schema; it is skipped when the variable is absent.
