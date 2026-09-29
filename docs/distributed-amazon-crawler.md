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

Each streamed product is processed on the server as `customization-normalizer → SEO B1–B6 (alt-only) → Shopify`. Alt-only mode keeps the original Amazon image URLs and changes only alt text; it does not download, convert, or upload WebP files. SEO configuration is read from root `.env.local`; local development also accepts the ignored `src/modules/seo-content/.env.local`. Root values take precedence. The public result records SEO engine/fallback metadata but never exposes credentials, image buffers, local paths, or proxy credentials.

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

Starting the Windows agent manually opens a light native dashboard. Left-click the tray icon or choose **Mở cửa sổ agent** to reopen it. Closing the window with X or Escape hides it in the tray; use **Thoát agent** to stop the process. Launching the EXE again with the same data directory brings up the existing dashboard instead of starting another crawler. The installer registers per-user auto-start with `--start-minimized`, so Windows login leaves the dashboard hidden. The Start menu shortcut and post-install launch open it normally.

The dashboard has **Công việc**, **Lịch sử**, and **Thông tin agent** tabs. It shows Amazon ASINs separately from the variants currently crawling, and also labels Pinterest POD tasks. Task completion and server delivery are separate states. Amazon progress uses per-input variant counts; Pinterest displays its current stage without presenting the existing placeholder percentages as measured progress. Pending product uploads and task results are counted across the entire local spool. Connection readiness is separate from the pause flag; pausing while offline does not claim a live connection. Resource readings display their sample time and whether the memory sample is complete.

**Tạm ngưng nhận việc** stops accepting new work while existing tasks continue. **Dừng và loại bỏ việc local** asks for confirmation, includes completed results still waiting for upload, and retains product caches. Offline cancellation intents are shown until acknowledged by the coordinator. **Mở thư mục dữ liệu** opens local logs and storage. Exiting the agent does not explicitly delete upload spool or product cache.

Local history lives in two additive tables in `agent.sqlite3`: `dashboard_tasks` and `dashboard_events`. Summaries retain seven days and at most 1,000 terminal task attempts; existing live leases and spool work remain protected. Activity retains seven days and at most 5,000 events, with the latest 500 displayed. Progress is matched by input and stored at phase transitions/completion, rather than writing every variant update. History contains bounded, redacted metadata, never product payloads, cookies, or credentials. On restart, the dashboard reconciles with local leases and shows recoverable work as waiting for reconciliation rather than claiming an old task is still running. A task attempt is keyed by task ID and lease ID, so replayed uploads do not create duplicate completions.

The existing tray tooltip, right-click controls, and transition-only CAPTCHA notification remain available. CAPTCHA never automatically brings the dashboard to the foreground. When a CAPTCHA event has no ASIN, a detection notice stays until the affected batch finishes; it does not mark every task as currently blocked. Tkinter/ttk uses the Python distribution's Tk/Tcl runtime and requires no new pip dependency. If dashboard initialization fails, the tray remains available and shows a notification; details go to the redacted agent debug log. `--no-tray` keeps the existing console mode on Windows and other platforms.

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
- `POST /api/v1/crawl-jobs/{jobId}/cancel`: cancels the job and discards its lease/spool data; product caches remain valid
- `POST /api/v1/crawl-jobs/{jobId}/retry-failed`
- `GET /api/v1/clients`
- `DELETE /api/v1/clients/cache`: clears all Amazon family, negative, and partial cache, plus coordinator negative and unprotected image cache; offline agents clear on reconnect
- `DELETE /api/v1/clients/cache/products/{asin}?amazonZip=10001`: invalidates one ASIN in one ZIP context, including offline agents on reconnect
- `DELETE /api/v1/clients/temporary-data`: removes abandoned write files and orphaned lease/spool rows while retaining product cache; offline agents apply this on reconnect
- `WebSocket /api/v1/worker/connect`: worker lease and heartbeat protocol

Heartbeat is sent every 10 seconds. A client becomes offline after 30 seconds and an unrenewed task lease is requeued after 60 seconds. Disconnects do not consume a crawl retry; crawler failures become terminal after three attempts. If stale and current clients both finish a requeued task, the first valid result wins and later uploads are acknowledged as duplicates.

Set `TEST_AMAZON_COORDINATOR_DATABASE_URL` to an isolated PostgreSQL test database before `npm test` to run the PostgreSQL persistence/lease integration test. The test creates and drops its own temporary schema; it is skipped when the variable is absent.
