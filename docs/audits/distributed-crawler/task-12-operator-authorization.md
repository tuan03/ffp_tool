# Task 12 — operator authorization and audit foundation

## Scope and deployment status

- Baseline `8f1ff04`, branch `cua_pro` retained by user instruction (exception to per-task branching).
- Original specification **23–24, 48**: operator permission boundary and durable audit foundation, not complete agent authentication or all operational audit events.
- Task 11 contract accepted through the user's instruction to implement the next task. D1/D5/D6 remain approved.
- Changed ownership: Coordinator authorization/migration, crawler tests, audit harness and documentation. No Gateway, Nginx, UI, installer, environment file or container configuration changes.
- **Opt-in application-factory capability only.** `create_coordinator_app(operator_credentials=OperatorCredentials(...))` enables the boundary in tests. The existing default application is unchanged in its authorization behavior; no production enablement or new environment flag is introduced. Do not describe the running VPS as protected by Task 12.

## Route audit and implementation

Nginx sends crawler APIs directly to Coordinator rather than through the Gateway's operator check. Therefore the authorization boundary is installed in Coordinator itself and does not trust an `X-Operator-Id`, `X-Gateway-Key`, client UUID or Bearer agent credential as operator proof.

The injected credentials use HTTP Basic semantics matching the existing Gateway operator login, with constant-time comparison and validation of incomplete credentials. They are not read from browser variables or stored in PostgreSQL. Production transport must be HTTPS; loopback HTTP is used only by isolated tests. Future wiring must obtain the existing operator credentials from the server configuration layer, not introduce a hardcoded alternative account.

Unsafe-method requests with a foreign Origin or cross-site Fetch Metadata are rejected even with valid Basic credentials, preventing browser ambient authentication from authorizing cross-site mutations. Public HTTPS proxy scheme/host handling must be verified at Task 19; do not disable this check to work around proxy configuration. Non-browser authenticated clients without Origin remain supported.

When enabled, all Coordinator HTTP routes require operator authorization except exact health/readiness/agent-release paths and the separate `/api/v1/worker/` and `/api/v1/internal/` namespaces. This protects management reads and mutations, including job creation, cancellation, client cleanup and review/image-profile administration. Unknown paths do not create an unauthenticated management fallback. CORS preflight does not authorize a subsequent request.

Worker HTTP/WSS authentication and legacy `cancelIntents` remain Tasks 16–17; pipeline endpoints retain their current dedicated-token contract. Consequently this foundation is **not** an end-to-end claim that agents cannot yet cancel jobs through the legacy worker channel. It must remain isolated from production until the complete security gate. Review Image bridge credentials are not changed.

## Durable audit semantics

New PostgreSQL table: `crawler_operator_audit`. Migration version **3** adds it without changing job/result/receipt records. SQLite implements the same schema for isolated unit tests only.

Each protected request records a generated correlation ID, server-configured actor or `unauthenticated`, HTTP method, matched route template, an optional validated hexadecimal target ID, timestamp, authorization/outcome reason and HTTP status. No request body, raw URL/query, untrusted username, headers, tokens or exception details are stored. Targets that are not safe domain IDs are omitted rather than copying arbitrary path strings.

- Persist `authorized` or `denied` before dispatch. Failed audit persistence returns `503 OPERATOR_AUDIT_UNAVAILABLE`; the management handler is not run.
- Bad/missing credentials return `401 OPERATOR_AUTH_REQUIRED` with a Basic challenge; spoofed headers and agent Bearer tokens do not change that result.
- After the handler returns, record `completed` or `rejected` plus the HTTP status. These describe the **HTTP response**, not completion of asynchronous jobs or streaming delivery.
- A handler exception leaves the durable authorization record with an unresolved outcome and returns a safe error. A failure to persist the response outcome returns `OPERATOR_OUTCOME_UNKNOWN`: side effects may already have committed, so callers must inspect state rather than blindly retry destructive commands.
- Correlation IDs are server-generated, not taken from untrusted request headers. No audit list/delete API or auto-retention policy is added in this task.

This is request-level audit, not transactionally coupled domain-command completion. The durable command ledger and action-specific completion audit remain Tasks 20–21/48.

## Tests and user verification

Run from the repository root with Docker Desktop and the existing loopback-only `ffp-local-postgres` container running:

```powershell
python scripts/audits/audit_lease_baseline.py --operator-auth
```

Expected: **4 tests, zero failures/skips per run**, repeated in two isolated PostgreSQL schemas; each schema is removed and its absence verified. No application tables, agent or containers are modified.

Coverage:

1. Anonymous, wrong Basic credentials, agent Bearer token and forged proxy/operator headers cannot list clients; anonymous cannot create a job. Valid operator can list clients and create a fixture job.
2. Audit records persist safe actor/outcome metadata and omit secret/query values. Mandatory audit outage prevents the job handler from being invoked. Outcome-write failure returns the explicit unknown-outcome error.
3. Empty credentials, malformed/oversized headers are rejected; credential object representation hides the password.
4. Upgrade from migration v2 adds the audit table, preserves an existing client record and is repeatable.

Focused local tests:

```powershell
python -m unittest discover -s src/modules/amazon-crawler/engine/tests -t src/modules/amazon-crawler -p "test_operator_authorization.py"
```

The PostgreSQL receipt suite was also rerun twice (10 tests per run, zero skips) after migration v3. Its legacy test name mentions v2, but its version assertion now covers v3. Unit fixtures use temporary SQLite files/in-memory connections; production server persistence remains PostgreSQL.

Final verification: `npm test`, `npm run typecheck`, `npm run build` passed. Crawler: 457 tests, 13 conditional skips; Review Image: 34 tests plus extension checks; Pinterest: 14 tests. The required PostgreSQL operator suite had zero skips. An earlier full run hit the unrelated SEO B4 timeout timing test; its isolated 13-test suite and the final full run passed without SEO code changes. A new in-memory SQLite migration fixture initially used a nonpersistent connection pool; the fixture was corrected and rerun. Existing Vite externalization/chunk-size warnings remain. No mock composition changes, so `build:mock` was not required.

## Compatibility and remaining work

- New optional factory parameter; no existing caller is forced into authentication. Enabled mode never falls back when credentials are malformed or audit storage fails.
- No schema migration has been applied to the running application database. A future Coordinator startup using this code will apply additive migration v3. Older binaries that reject newer migration versions cannot simply be restarted against v3: use a reviewed rollback/restore plan, never delete migration metadata to bypass the guard.
- Task 13 adds key creation under this operator boundary. Agent keys do not exist yet.
- Environment wiring, browser credential flow, Nginx/public HTTPS integration, rate limiting for authentication/audit abuse and actual production cutover must be verified before Task 19 acceptance. No production security-completion checklist is ticked here.
- No rebuild/restart/push/deploy performed. User acceptance pending; Task 13 not started.
