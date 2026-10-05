# Step 02 — Crawler operator UI compatibility

Date: 2026-10-04. Scope: Crawler UI only, following approval to verify UI compatibility
before advancing beyond the Task 14–19 auth gate. Work stays on `cua_pro` by explicit
user instruction (exception to the standard task-branch workflow).

## What changed

The Crawler service previously made management requests without operator credentials.
Those requests receive 401 when the secure Coordinator factory is enabled. The page
now discovers `/api/v1/worker/security` before loading its management UI:

- Explicit auth protocol 1: show an operator login form.
- Legacy endpoint 404: retain existing service wiring; no auth enabled implicitly.
- Network, malformed response, or other HTTP failure: stop with an error, not legacy fallback.
- Mock composition: skip discovery and keep the injected mock services.

Authenticated clients reuse existing service implementations. Basic credentials stay
in page memory, never localStorage/sessionStorage, and are restricted to the configured
Coordinator origin and crawler management route allowlist. Remote HTTP is rejected;
HTTP is permitted only on loopback. Redirects are rejected. Logout aborts pending
requests and subsequent calls; a management 401 clears the session. Reload requires
login again. This is not a new general-purpose authentication system or a server session.

Changed areas:

- `src/modules/amazon-crawler/service.ts`: discovery and destination-bound transport.
- `src/modules/amazon-crawler/ui/AuthenticatedCrawlerPage.tsx`: login/session wrapper.
- Module routes and `AmazonCrawlerPageProps`: internal composition.
- `src/app/routes/AppRoutes.tsx`: pass the already configured Coordinator URL; omit it
  for mock. This coordinated main-owner edit is required to select the correct mode.
- Audit scripts: isolated HTTPS UI host, explicit Shopify fixtures and browser checks.

No backend route, database migration, dependency, production environment variable or
Compose topology changed. The route function has one optional trailing URL argument;
existing callers without it retain their prior behavior. No operator credentials are
passed to Shopify, installer downloads, agent endpoints or other modules.

## Isolated test environment

`local_auth_sandbox.py serve --ui` uses the existing audit PostgreSQL database with a
new private schema, its own source-agent process and loopback HTTPS Coordinator.
It serves the production-built React app from ignored `.runtime/auth-ui-dist`.

The agent is online (`paused: false`) so UI admission checks work, but the sandbox
Coordinator returns **no leases** (`claimsDisabled: true`). Creating a test job cannot
launch a real crawl. `test-outbox` is intentionally rejected in this UI mode; use the
separate paused-agent sandbox for that earlier test.

Only Shopify store listing and ASIN preflight are explicit fixtures. All other Shopify
operations return 503. This does **not** verify real Shopify access, collections or sync.
The supplied browser helper blocks requests outside the sandbox origin. An installer
release warning is therefore expected; do not interpret it as an auth regression.
Other application pages are out of scope in this minimal host.

Operator login is generated per run in `.runtime/auth-sandbox/<run-id>/operator-login.json`,
under the current-user-only Windows ACL. It is not a production credential. The helper
reads it without printing it. Runtime files, certificates, credentials, agent outbox and
screenshots are ignored by Git. Closing the browser does not stop the test supervisor.

## User acceptance: current sandbox is already running

From the repository root, open the dedicated browser:

```powershell
python scripts/audits/audit_crawler_operator_ui.py --manual
```

The helper checks rejection of a wrong password, signs in with the private test
credential and leaves the UI open. Keep the command running until finished.
It scopes certificate-error suppression to the generated certificate's SPKI in this
one browser process; it does not install a CA or disable certificate checks globally.
The real agent continues to use its scoped CA trust with HTTPS/WSS verification.

Check one item at a time:

1. Agent `FFP isolated auth test` is online and metrics load.
2. Enter `B0FR4MSS2H` in the ASIN input, then click **Start (1)**.
3. Confirm a job appears. It stays queued because all real leases are disabled.
4. Click **Hủy job**. Cancellation is accepted; the job may briefly show `cancelled`
   before the Coordinator removes it from the visible list.
5. Click **Đăng xuất operator** and confirm the login form returns. Reload still
   requires login. To sign in again without copying credentials, close the test
   browser and rerun the helper.

Do not test other modules, real store writes, real crawl throughput or installers here.

Automated regression and status:

```powershell
python scripts/audits/audit_crawler_operator_ui.py
python scripts/audits/local_auth_sandbox.py status
```

Stop only this sandbox when finished:

```powershell
python scripts/audits/local_auth_sandbox.py stop
```

Restarting creates a new isolated run; old schemas/files are retained for inspection.
To rebuild the test UI and start a new run after stopping the old one:

```powershell
$env:VITE_APP_ENV = 'production'
npm run build -- --outDir .runtime/auth-ui-dist
python scripts/audits/local_auth_sandbox.py serve --ui
```

Use another terminal for the browser helper. Requires the existing audit PostgreSQL
container, Python dependencies and installed Playwright Chromium. No production
Docker rebuild is needed for these checks.

## Verification and remaining gates

- Five focused TypeScript tests passed: origin/route/redirect boundaries, absolute dispatch,
  discovery fail-closed behavior, logout abort and unauthorized callback.
- Real Chromium + isolated HTTPS Coordinator + PostgreSQL + real source agent passed twice:
  wrong login, successful login, agent listing, create/list/cancel job, no password in
  browser storage, logout and reload. A simulated management 401 verifies UI invalidation.
- Existing sandbox Windows file-lock regression test passes.
- `npm test`, `npm run typecheck`, production build with isolated output and
  `npm run build:mock`: passed after the implementation changes. Skipped tests are not acceptance.
- Existing Node-module externalization and large-bundle warnings remain outside scope.

This is **partial Step 02 / Task 19 evidence**, not completed composed-runtime or public
HTTPS acceptance. Remaining: user UI acceptance, Pinterest service-to-Coordinator and
Review Studio compatibility, legacy asset migration, production-shaped Nginx/TLS,
packaged agent/clean Windows and approved auth rollout. Do not advance to Task 20 yet.
Existing application containers and agents were not restarted; no push or VPS change.
