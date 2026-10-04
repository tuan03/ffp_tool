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
