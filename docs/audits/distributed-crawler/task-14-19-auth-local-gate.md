# Tasks 14–19: identity/auth implementation and local gate

Date: 2026-10-04. Branch: `cua_pro`, retained by explicit user instruction.

## Scope and acceptance status

The user approved implementing Tasks 14–19 together, then explicitly approved
the coordinated Pinterest upload changes while preserving existing asset URLs.
Only the live VPS domain is available. This work does **not** enable production
authentication, deploy, restart the running application, publish an installer, or
claim public HTTPS acceptance.

| Task | Original specification sections | Implemented in source | Acceptance still needed |
| --- | --- | --- | --- |
| 14 | 2, 4–5, 19 | Server-issued identity; locked/idempotent registration; repeat request returns same identity; different installation requires operator rebind | User acceptance |
| 15 | 2, 4, 23, 51 | HTTPS origin validation; hidden CLI key prompt; Windows user-scoped DPAPI; durable enrollment request; preserve existing identity when old work remains | Packaged agent setup and separate Windows-user/machine testing |
| 16 | 19, 23–24 | Bearer key on result/product uploads; identity-header binding plus existing lease fencing; Pinterest task/lease ownership and namespace reservation | Legacy Pinterest namespace ownership inventory before cutover |
| 17 | 6–7, 23–24 | WebSocket handshake authentication; revalidate per message and before claim, including idle sessions every two seconds; server clamps capacity/crawler permissions; revoke closes with 4004; agent reports NEED_REAUTH without deleting outbox | Full authenticated real-agent/TLS/restart acceptance |
| 18 | 3–5, 23 | Audited revoke/rotate/rebind and explicit legacy identity adoption; preserve identity on rotation; operator UI with one-time key display | User UI and reinstall/retained-outbox acceptance |
| 19 | 2–5, 19, 23–24 | Real local Nginx + Coordinator + isolated PostgreSQL smoke; enrollment, operator Origin/port, 401, private-route 404 and WebSocket upgrade | **Not complete:** public TLS, composed-service compatibility and cutover approval |

No checkbox is marked accepted merely because source or automated tests exist.
Task 20 must wait for the remaining G2 acceptance work or an explicit user decision.

## Architecture and storage

- Production remains `client`, `server`, `database`. No new permanent process/container.
- Coordinator owns authentication and Pinterest asset ownership within `server`.
- PostgreSQL additive migration 5 stores enrollment; migration 6 stores asset namespace ownership.
- Agent SQLite remains a local durable outbox/identity store, not a server production database.
  It stores only a DPAPI-protected credential blob, never the raw Agent Key.
- DPAPI uses the current Windows user, without `CRYPTPROTECT_LOCAL_MACHINE` and without
  plaintext fallback. Origin is inside the protected blob. Changing server URL cannot
  cause the stored key to be sent to another origin. HTTP redirects are rejected.
- This is not hardware attestation. Copying a database within an account that can
  decrypt the credential is not prevented; simultaneous connections remain limited
  to one session per identity. Clean-machine/cross-account testing remains pending.
- Temporary `ffp-auth-audit-<uuid>` Nginx containers and `ffp_audit01_<uuid>` PostgreSQL
  schemas belong only to the test harness and are removed after each run. App data,
  app containers and the VPS are not modified.

DPAPI implementation follows Microsoft's documented user-scoped protection and
`LocalFree` ownership: [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata),
[CryptUnprotectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata).

## Contracts and operator workflow

The secure Coordinator factory requires both `operator_credentials` and
`agent_environment="test"` or `"production"`. Defaults remain legacy. The production
composition root intentionally has **not** been switched to this factory mode.
Rebuilding alone does not enable authentication.

Routes:

- `GET /api/v1/worker/security`: explicit secure-mode discovery.
- `POST /api/v1/worker/register`: Bearer Agent Key, `requestId`, `displayName`.
- Existing result/product routes: same envelope and lease contract plus Bearer key.
- Existing Pinterest upload routes: Bearer key plus `X-Task-Id` and `X-Lease-Id`.
- Existing WebSocket: Bearer header, `authProtocol: 1`, server-issued `clientId`.
- `POST /api/v1/agent-keys/{id}/revoke`: operator Basic, idempotent revocation.
- `POST /api/v1/agent-keys/{id}/rotate`: operator Basic, creation fields plus
  `rebind: false` for normal rotation, `true` for a replacement installation.
  A new raw key is returned once; retrying the same request ID cannot reveal it again.
- `adoptAgentId` with `rebind: true`: explicit operator adoption of an existing legacy
  identity using an unbound key. No agent can authorize adoption by presenting a UUID.
- `/amazon-crawler/agent-keys`: operator UI; create/list/rotate/rebind/revoke.
  Credentials remain in page memory; no browser storage. UI key expiry is 30 days;
  API supports explicit future expiry. Rotation in UI preserves existing permissions.
  List currently displays the first 50 keys; API supports bounded pagination.

On a separately configured secure HTTPS test deployment, set `authMode` to `key`
in the private agent configuration, then run:

```powershell
$env:PYTHONPATH = 'src/modules/amazon-crawler'
python -m engine.distributed.client_main --config <private-config-path> --enroll
```

Packaged executables accept `--config ... --enroll` directly. Key input is hidden and
must not be passed as a command-line argument, environment variable, Git file or chat message.
Registration request ID is persisted before the network request, allowing safe retry
after a lost response. Existing pending work prevents an unapproved identity change.
The module command avoids the development launcher's legacy localhost default.
`AMAZON_COORDINATOR_URL`, if already set, still takes precedence over the JSON URL;
verify it points to the intended HTTPS test origin before enrollment.

The new code is not automatically injected into an already installed agent or running
Docker image. A signed package rebuild and an explicitly approved deployment are separate steps.

## Pinterest compatibility and fail-closed behavior

Public asset URL shape remains `/api/pinterest-pod/assets/<namespace>/<filename>`.
Existing images remain readable; there is no move, rename or deletion of old assets.

For authenticated writes, Coordinator validates the key, crawler permission, task
owner, active lease and expiry. A namespace is bound to one task in PostgreSQL; another
task cannot overwrite it. Namespace reservation is serialized on PostgreSQL and the
lease lock is held through the file replacement. Binary files remain in the durable
asset volume, not PostgreSQL. Temporary files are unique and flushed before rename.

An existing directory without ownership metadata returns
`ASSET_NAMESPACE_REQUIRES_OPERATOR_BINDING`, rather than trusting an agent-provided
`runId`. Before production cutover, inventory those legacy directories and approve a
mapping/migration. This batch deliberately does not infer or bulk-import ownership.
Cross-job reuse of a prior run namespace must be addressed in that migration. Agent
asset upload failures no longer silently report successful completion in secure mode;
local files remain. Full durable binary-outbox recovery is not claimed by this change.

Database metadata and filesystem rename are not one distributed transaction. A crash
between them may leave an unbound directory requiring operator reconciliation; it must
not be reclaimed automatically by another agent.

## Safe local checks for the user

Follow-up: [Step 02 real-agent sandbox](step-02-real-agent-sandbox.md) records the
separate HTTPS/WSS source-agent process and its manual restart/key/outbox checks.
This is additional evidence, not completion of the composed-runtime/public gate.

Next follow-up: [Crawler operator UI](step-02-crawler-operator-ui.md) records the
authenticated UI adapter and isolated browser create/cancel checks. User acceptance,
Pinterest/Review Studio compatibility and the public/composed gate remain pending.

Run from the repository root with Docker Desktop and the existing isolated local
PostgreSQL test container available:

```powershell
python scripts/audits/audit_lease_baseline.py --identity
python scripts/audits/audit_lease_baseline.py --proxy-auth
$env:PYTHONPATH = 'src/modules/amazon-crawler'
python -m unittest engine.tests.test_client_credentials -v
```

`--identity` runs enrollment/HTTP/assets/session/lifecycle fixtures on isolated
PostgreSQL schemas twice. `--proxy-auth` also starts a temporary Nginx container using
the existing `ffp-client` image and a temporary real Coordinator HTTP/WebSocket listener.
It checks the repository Nginx config with only upstream destinations replaced for
the test. It does not target a VPS, access Shopify or crawl Amazon/Pinterest.

Expected final message for the proxy gate:

```text
PASS: local PostgreSQL and real Nginx auth gate twice; public HTTPS acceptance still pending.
```

## Remaining G2 gates: do not enable production auth yet

1. Agree a safe isolated public HTTPS test route/deployment or maintenance window;
   do not run revoke/fault scenarios against working production agents.
2. Verify certificate validation, WSS, real Windows agent reconnect, credential
   persistence, rotation/rebind and pending outbox recovery through that public URL.
3. Verify the **composed** app, not just Coordinator: existing crawler UI calls,
   Pinterest service-to-Coordinator calls and Review Studio bridge authentication
   need their own compatibility checks/adapters before enabling the operator boundary.
   The local proxy smoke is not evidence that these composed flows already pass.
4. Inventory and migrate approved legacy Pinterest namespace ownership.
5. Rebuild/test the packaged agent; cross-user/clean-machine testing is still pending.
6. Approve explicit runtime auth wiring, rollout/rollback and maintenance timing.

Compatibility in source: legacy agent → legacy server unchanged; legacy agent →
secure server rejected; key agent → legacy server fails registration rather than
falling back; key agent → secure factory is covered by targeted fixtures, with full
TLS/packaged-agent acceptance pending.

## Verification record

- Targeted Python identity/credential suite: 13 tests passed locally, including real Windows DPAPI.
- `--proxy-auth`: two isolated PostgreSQL runs and real Nginx HTTP/WebSocket smoke passed.
- TypeScript management client tests: 2 passed.
- `npm test`: passed; engine 473 tests (13 skipped), Review Image 34 passed,
  Pinterest 14 passed; tooling/web/Gateway stages passed. Skips are not acceptance evidence.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run build:mock`: passed.
- Existing build warnings remain: Node modules externalized in unrelated browser
  imports and large chunks. They were not suppressed or repaired in this scope.
- `git diff --check`: passed. Runtime containers remain healthy and were not restarted.
- No public HTTPS check, clean-machine claim, production migration, push or deployment.

## Pinterest compatibility follow-up (2026-10-04)

The user accepted the Crawler UI checks, then approved repairing Pinterest auth
compatibility. Work remains on `cua_pro` as instructed, not a new task branch.

### Implemented boundary

- Optional server-only `PINTEREST_OPERATOR_USERNAME` and `PINTEREST_OPERATOR_PASSWORD`
  must match the secure Coordinator operator account. Both blank preserve legacy mode;
  partial configuration fails closed. These are documented in `.env.example` but no
  real environment, Compose process or VPS setting was changed.
- Pinterest management and asset reads require an operator session when configured.
  Login uses same-origin HTTPS (loopback HTTP allowed for development). The server
  verifies the password and Coordinator access before issuing a random one-hour
  HttpOnly, SameSite=Strict cookie; HTTPS adds Secure. Sessions are bounded, in memory,
  and invalidated by logout, restart, expiry or credential change. Passwords are not
  stored in browser storage; no credentials are added to asset URLs.
- Unsafe cross-origin requests are rejected before executing handlers. Health and
  readiness stay public. OAuth callbacks retain their existing signed-state validation
  because a cross-site redirect does not carry the Strict cookie.
- Backend credentials are sent only to allowlisted management paths on the configured
  Coordinator origin, over HTTPS or loopback HTTP. Credentialed redirects are rejected.
- Agent listing/forget now go through session-protected Pinterest endpoints rather
  than unauthenticated browser calls to Coordinator. Auth/network errors are surfaced
  rather than converted to an empty agent list. Job-list auth failures also propagate.
- Readiness probes authorized `/api/v1/clients`, not just public health.
- Asset URL paths are unchanged. In secure mode they are private/no-store and require
  the operator cookie; in legacy mode the previous public behavior is preserved.

Changed ownership: Pinterest service/UI/server and focused tests; main route composition
only passes the mock opt-out flag; `.env.example` documents server-only configuration;
`scripts/audits/pinterest_auth_sandbox.py` provides isolated verification. No Coordinator
auth weakening, production database migration, new dependency or production container.

### Evidence and scope

- Pinterest Python suite: 22 tests passed, including session creation/logout, missing
  auth, origin rejection, protected assets, OAuth state rejection, expiry, configuration,
  readiness and destination/redirect checks.
- Pinterest service tests: 50 passed; operator-session transport tests: 3 passed.
- Real Chromium -> local HTTPS Pinterest -> local HTTPS authenticated Coordinator ->
  private PostgreSQL schema passed repeatedly: login rejection/success, agent list,
  readiness, create/status/cancel, asset 401/200/401, cookie flags and logout.
  Job create/cancel in this helper uses browser fetch, not the full UI discovery wizard.
- `audit_lease_baseline.py --proxy-auth`: two real PostgreSQL/Nginx runs passed, including
  agent asset ownership/expiry fencing. This remains a separate HTTP Nginx test, not
  proof of the complete Pinterest production proxy/TLS path.
- Production build uses `--outDir .runtime/auth-ui-dist`; mock build and typecheck pass.
  Full `npm test` passed; skipped tests are not acceptance.

### Manual acceptance

The active Coordinator UI sandbox must remain running with `claimsDisabled: true`.
The assistant started a separate **test-only** Pinterest HTTPS process, using the same
private PostgreSQL schema. It is not an extra production Compose service. Private
runtime files and credentials remain under ignored `.runtime/auth-sandbox/<run-id>`.

```powershell
python scripts/audits/pinterest_auth_sandbox.py test
python scripts/audits/pinterest_auth_sandbox.py manual
```

The manual helper automatically logs in and creates one queued fixture job. Check:

1. Pinterest page opens without a recurring login dialog or auth error.
2. Expand the agent panel: the existing isolated agent is listed. The general panel
   may say an agent is online while the Pinterest-specific status says offline:
   this test agent is Amazon-only, not a Pinterest-capable logged-in browser.
3. Expand job history: `audit rug` is present. It does not crawl; all leases are disabled.
4. Open `/api/pinterest-pod/assets/audit-fixture/preview.png` on the same sandbox origin
   in that dedicated browser: the tiny fixture image is available after login.
5. Log out and reload that asset: expect 401. Log in again by rerunning the helper.

Pinterest OAuth status is deliberately a fixture with no real account. Trends, AI,
production, Shopify writes and external browser requests are blocked. Do not treat
disabled discovery controls or the Pinterest account warning as an auth failure.
Close the dedicated browser after testing. Stop the Pinterest test service separately:

```powershell
python scripts/audits/pinterest_auth_sandbox.py stop
```

This retains test data/files. A stopped run has a `pinterest-ui.stop` marker; follow
the tool's explicit restart instruction or create a fresh Coordinator sandbox.

### Remaining acceptance limitations

User Pinterest acceptance remains pending. Review Studio, real Pinterest agent crawl,
OAuth login, AI production, Shopify handoff/sync, packaged agent, legacy asset ownership
migration and public/composed TLS acceptance have not been established by this fixture.
Secure-mode anonymous asset downloads are intentionally denied: non-browser consumers
that currently expect public URLs need a reviewed delivery mechanism before rollout.
Do not enable production auth or mark Task 19 complete on this evidence alone.

## Review Studio auth-boundary follow-up (2026-10-04)

The user accepted the Pinterest sandbox and approved repairing the Review Studio
boundary after a bridge-only request was reproduced as 401 under Coordinator auth.
Changes remain on `cua_pro` by instruction; no push, container restart or VPS change.

### Implementation

- The composed Review app exposes a server-side authorization callback. It checks
  its internal bridge token, an exact registered HTTP route/method match and the
  presence of the existing bridge-token dependency. A URL prefix is not sufficient.
- `scripts/coordinator_app.py` registers that callback on the parent Coordinator.
  It accepts optional injected `operator_credentials` for integration verification;
  the default deployment call does not enable new operator auth implicitly.
- Coordinator accepts this narrowly scoped bridge identity without also requiring
  Basic operator credentials. Origin checks and durable audit still run; the audit
  actor is `review-image-bridge`. The child handler independently checks its token.
- The bridge token cannot access crawler management or replace the pipeline key.
  Extension WebSocket authentication remains separate and unchanged. No new port,
  process, container, route, environment variable or token in browser code.

Changed files: Coordinator operator middleware, Review runtime and deployment composition;
cross-module integration checks live in `scripts/audits/test_review_operator_boundary.py`,
not inside another module's unit suite. No database migration or dependency change.

### Reproducible local checks

```powershell
$env:FFP_REVIEW_AUDIT_POSTGRES = '1'
python -m unittest scripts.audits.test_review_operator_boundary -v
Remove-Item Env:FFP_REVIEW_AUDIT_POSTGRES
```

Requires the existing loopback-only `ffp-local-postgres` audit container. Two tests
must report `OK` with no skips. The PostgreSQL test uses the actual composition factory
and a random private schema, then drops only that schema and verifies its absence.
The other test uses temporary SQLite solely as a focused auth fixture; this does not
change production persistence. No application database, store or template is modified.

Without the environment switch the SQLite test runs and the PostgreSQL check skips;
that is not equivalent to full integration evidence.

Verified: missing/wrong/extension token cannot call HTTP management, correct bridge
token reads health/templates and writes a fixture template, bridge token cannot call
crawler management or pipeline claim, wrong-origin writes are rejected, accepted
requests have an audit record, extension rejects the wrong token with 4401 and accepts
two successive authenticated hello/ping connections. Actual composed PostgreSQL health,
templates, readiness and extension handshake also pass.

Additional verification: 34 Review Image Python tests plus extension scripts passed;
six Gateway handler tests passed. `npm test`, `npm run typecheck`, `npm run build`
and `npm run build:mock` passed. The full suite retains its conditional skips;
the dedicated two-test PostgreSQL-enabled boundary audit passed without skips.
Existing browser externalization/large-bundle warnings remain out of scope.

### Acceptance boundary

These are ASGI/integration fixtures, not a browser driving a real ChatGPT tab. Existing
image-flow tests use synthetic extension results. Store loading, actual extension DOM
interaction, real image generation, public Nginx/WSS and Shopify writes are not newly
accepted here. Extension tokens remain static, with no new automatic expiry/revocation
feature. No real extension settings or tokens were changed.

Next: user runs the above audit and confirms its result; coordinate a separate safe
UI/real-extension acceptance if needed. Do not mark all Task 19 gates complete or move
automatically to Task 20 based solely on these tests.
