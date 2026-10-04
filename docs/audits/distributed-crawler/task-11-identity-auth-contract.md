# Task 11 — identity, authorization and state compatibility contract

## 1. Status, scope and approved decisions

- Baseline: `e395231`; branch `cua_pro` by explicit user instruction, overriding per-task branching.
- Original specification: **2–6, 23–24, 51** (design contract only). This document does not claim runtime compliance with those sections.
- Task 10 was accepted through the user's instruction to advance. No additional manual-test transcript was supplied.
- The user explicitly approved **D1, D5 and D6** before this document was written.
- Scope: documentation only. No code, schema, route, dependency, credential, container, agent or VPS configuration changes. Task 12 is not started.

| Decision | Approved policy | Deployment boundary |
| --- | --- | --- |
| D1 | Move from the earlier public/no-auth exception to Agent Key authentication | Implement and test first; production enforcement requires separate approval at/after Task 19 |
| D5 | An agent may stop/release only its own work; only an authorized operator may cancel an entire job | Remove the agent-to-job-cancel privilege when implementing the secured contract; preserve outbox |
| D6 | One key binds one server-issued agent identity; separate machines enroll separately | Rotation preserves identity; moving/rebinding a machine requires operator approval and audit |

The old no-auth exception is superseded as the **target architecture**, not silently switched off on the running deployment. Until the actual security gate passes, `CRAWLER-04` and `INFRA-AGENT-05` must not be marked complete.

## 2. Source evidence and current gaps

| Source | Current behavior | Required change owner |
| --- | --- | --- |
| `engine/distributed/client_store.py`, `client_id()` | Generates a local UUID in SQLite `agent_identity` | Task 14/15: server authority and durable enrollment |
| `engine/distributed/__init__.py` | Agent version 5.2.2; worker protocol 5 supported | Task 14–17: explicit secure compatibility negotiation |
| `engine/distributed/coordinator_server.py`, `worker_socket()` | Trusts client-supplied identity; rejects a simultaneous duplicate connection but does not authenticate ownership | Task 14/17: authenticated binding and session checks |
| `client_agent.py`, `stop_and_discard_local_work()`; `worker_socket()` | Local stop creates `cancelIntents`; server invokes `cancel_job` for them | Task 16/17: reject this authority for agent credentials; Task 22/24/28: scoped local controls |
| Coordinator result/product routes | Compare payload identity with headers and enforce lease/checksum | Task 16: additionally derive identity from the credential; headers are not proof |
| `client_agent.py`, recovery gate and upload loops | Existing recovery, immutable retries and quarantine from Tasks 02–09 | Preserve these guarantees under auth failure and migration |
| `gateway/server.ts` | Existing operator Basic authentication configuration | Task 12: audit/reuse the actual operator boundary; do not assume all Coordinator routes are already protected |

Paths in the first six rows are under `src/modules/amazon-crawler/`. Agent version checks, a UUID and a lease token are not substitutes for authentication. Existing internal pipeline and Review Image credentials remain separate.

## 3. Identity and enrollment contract

### Authoritative records

- PostgreSQL owns `agentId`, key binding/status, allowed capabilities/capacity, enrollment receipt and operator-approved legacy mapping.
- The agent's SQLite record owns its durable local reference to the server identity and enrollment transaction status. Do not create a competing authoritative JSON identity file.
- Windows OS-protected credential storage owns raw agent credentials under the account running the agent. Task 15 selects and verifies the concrete OS mechanism; no raw key in SQLite, installer, browser storage, Git, logs or command-line arguments.
- Display name, hostname, local UUID and machine fingerprints are descriptive metadata, not proof of ownership.
- Preserve local `resultId`, original payload, checksum and lease metadata. Never rewrite a pending upload's identity fields in place merely to fit a newly assigned identity.

### First enrollment and lost response

1. Operator creates a key with explicit permissions/capacity/expiry. Raw key is shown once; server stores a verifier, not recoverable plaintext.
2. Agent persists a nonsecret enrollment request ID before sending the request over HTTPS.
3. Server validates the key and binds one identity transactionally. Retry with the same key/request returns the same identity; a conflicting request cannot allocate another identity or silently rebind.
4. Agent durably records identity and credential reference before advertising capacity. Interrupted enrollment resumes that same request, not a fresh UUID each boot.
5. Failure to recover the key requires operator rotation/re-enrollment; no endpoint reveals an existing raw key.

The concrete endpoint/field names and supported protocol version are to be implemented with both consumers in Tasks 14–17. Do not bump today's `PROTOCOL_VERSION` in this documentation task. Secure capability/version negotiation must be explicit and covered by the compatibility tests below; a self-reported capability never grants permission.

### Existing installations and pending results

1. Close admission and inventory existing local identity, assignments, pending/quarantined results and original checksums; preserve the local database and assets.
2. Operator explicitly associates the legacy installation with a newly authenticated server identity. Possession of a claimed legacy UUID alone must never authorize this association.
3. Persist the approved legacy-to-authenticated mapping server-side with actor/time/reason. Authenticate first, then authorize legacy upload ownership through that mapping and the original lease/receipt records.
4. Keep stored upload envelopes byte/content-equivalent for checksum purposes. A mapped historical identity is allowed only for the approved installation's historical uploads, not for new leases or arbitrary other clients.
5. Completed results retry their historical receipts. Expired/cancelled attempts retain the established quarantine disposition; authentication must not revive authority.
6. Unmapped/conflicting legacy data remains local and visible for operator resolution. Never erase it, assign a random new owner, or recrawl just because enrollment failed.

Required tests: lost enrollment response; crash between credential and SQLite persistence; conflicting enrollment; populated spool migration; legacy-ID spoof; repeat migration; upload ACK lost before/after cutover. If a safe legacy ownership check is unavailable, block automatic migration and request operator reconciliation rather than trusting the old identity.

## 4. Permission boundaries

| Action | Agent credential | Operator authorization | Internal pipeline credential |
| --- | --- | --- | --- |
| Register/reconnect/heartbeat | Own identity only | Manage identity lifecycle | No |
| Claim and upload/retry | Own authorized leases/historical receipts only | No implicit impersonation | No |
| Pause/stop local execution | Own agent only, retain results | May issue scoped controls | No |
| Cancel an entire job/global stop/purge | Denied | Explicit authorized operation with audit | No implicit operator rights |
| Create/list metadata/rotate/revoke/rebind keys | Denied | Authorized operator only | Denied |
| Internal SEO/Shopify pipeline operations | Denied | Not automatically granted by UI login | Existing scoped internal contract |
| Review Image extension bridge | Agent Key is not accepted as bridge credential | Existing bridge/operator boundary | Existing dedicated credential where applicable |

Anonymous requests must not obtain agent or operator authority in the secured deployment. Public health/bootstrap metadata, if retained, must be explicitly allowlisted and contain no credentials or private agent/job data.

For both HTTP and WebSocket, the server derives the principal from the validated key; any clientId/header must agree with that principal or an explicit historical-upload mapping. Check permissions, ownership and key status on each mutating path. Revoke/expiry must affect already-open sessions; handshake-only checks are insufficient.

Operator-facing actions must use the real operator boundary, not accept an Agent Key as an admin token. Task 12 inventories direct Coordinator, Gateway and Nginx paths before adding endpoints. Audit records contain actor/key ID, target, outcome, reason and correlation ID, never raw authorization headers or result payloads.

## 5. Local stop compatibility (D5)

- Secure agent messages must not execute legacy job-wide `cancelIntents`. Reject that capability explicitly and audit the denial; do not silently process it for compatibility.
- Retain old pending intents as local migration evidence, but do not replay them as operator authorization. Acknowledge/dispose of them only through an explicit migration/control disposition; do not claim the job was cancelled.
- Local pause stops new admissions. Local soft stop allows current work to finish and persist. Releasing work must identify the authenticated agent's exact task/lease and preserve its outbox.
- Server determines whether released work is requeued according to job state. Do not mark the whole job cancelled because one machine stopped.
- Hard/per-task interruption depends on worker isolation (Tasks 25–28). Do not promise selective process termination before that capability exists.
- If the new lease-scoped release path is not ready during security rollout, disable the unsafe job-wide stop action and explain the limitation; do not retain the privilege as a fallback.

## 6. State compatibility

These are target conceptual states, not a database rename in Task 11. Keep existing lower-case transport/storage fields through an explicit adapter while consumers migrate.

| Dimension | Target meanings | Existing mapping/constraint |
| --- | --- | --- |
| Connectivity | CONNECTING, ONLINE, OFFLINE | `_is_connected` is authoritative for transport; legacy `connection='paused'` alone does not establish connectivity |
| Desired execution | RUNNING, PAUSED, DRAINING, STOPPED | Persist separately; heartbeat must not overwrite an operator/local pause |
| Applied execution | RUNNING, PAUSED, DRAINING, DRAINED, STOPPED | DRAINED requires the agreed running/outbox checks, not merely a sent command |
| Authentication | UNENROLLED, AUTHENTICATED, NEED_REAUTH | Invalid/revoked/expired credential closes admission, preserves spool and shows a recoverable operator action |
| Health | HEALTHY, DEGRADED, UNHEALTHY | Storage faults/quota remain admission gates independent of connectivity |
| Local result | PENDING_UPLOAD, QUARANTINED, ACKNOWLEDGED | `completed_pending_upload` is not server SUCCESS; only a valid durable receipt authorizes local removal |

Admission requires all relevant conditions: authenticated supported session, recovery complete, allowed desired/applied mode, health/capacity within limits and server admission permission. A RESUME message cannot bypass another gate.

The specification's summary labels are projections, not replacements for these dimensions: REGISTERING during enrollment; READY when admission is open with spare capacity; BUSY when executing; PAUSED/DRAINING/STOPPED from applied execution; DEGRADED/UNHEALTHY from health; OFFLINE from transport. UPDATING is a maintenance mode owned by the updater tasks and closes admission. REVOKED is the server key/identity authorization disposition; the agent shows NEED_REAUTH. The UI must retain the underlying dimensions so, for example, an offline paused agent does not lose its desired pause. Priority/display tests belong to Task 36; revocation must close authorization regardless of the chosen display label.

Distinguish network retry from authentication failure, permission denial, stale lease, checksum conflict and unsupported protocol. Preserve existing stale/conflict quarantine; auth failure must not be translated to successful ACK or data deletion. Avoid rapid authentication retry loops; expose NEED_REAUTH without leaking key material. Exact HTTP/WSS error codes and retry intervals require contract tests in Tasks 16–17, not ad hoc strings in UI code.

## 7. Compatibility matrix and rollout gate

| Agent | Server mode | Expected |
| --- | --- | --- |
| Current no-auth agent | Current legacy deployment | Existing behavior until separately approved cutover; not security compliant |
| Current no-auth agent | Secured test/production mode | Explicit upgrade/enrollment rejection; no lease or mutation; keep local spool |
| Updated authenticated agent | Secured server, valid binding | Authenticate, apply controls/reconcile, retry outbox, then admit work |
| Updated agent | Old server lacking secure support | Fail closed with unsupported-server guidance; never silently downgrade to anonymous |
| Updated agent, invalid/expired/revoked key | Secured server including an already-open WSS session | Stop admission, reject unauthorized operations, retain results, NEED_REAUTH |
| Updated agent, valid key A claiming identity/task B | Secured server | Deny without mutating B or revealing its private records |
| Unsupported protocol | Any secured session | Reject before dispatch; no implicit compatibility guess |

Legacy and secured modes describe deployment policy, not an already-existing environment variable. Do not add a production flag that automatically falls back to legacy when credentials are missing. No per-request anonymous fallback on a protected endpoint. Test the complete path through Nginx at Task 19 before requesting cutover.

Rollout order: operator authorization (12), key creation (13), idempotent identity registration (14), local setup/storage (15), HTTP enforcement (16), WSS enforcement (17), lifecycle/migration (18), public integration gate and explicit cutover approval (19). Partial enforcement must remain isolated from production.

Rollback must not reopen anonymous access automatically. Before any data migration, record recoverable identity/spool state; on an incompatible rollback, stop admission and retain data. Operational recovery of credentials remains separate from rollback of code.

## 8. Binding, rotation and security limits

One key/identity is an authorization binding, not hardware attestation. Blocking a second simultaneous session prevents a common collision but cannot prove that a stolen credential is on the original physical machine. Do not advertise absolute clone prevention.

- Rotation preserves the agent ID and outbox; old-key overlap, if needed, must be explicit, bounded and audited rather than indefinite dual credentials.
- Revoke closes authorization, including sessions; it does not delete results or implicitly cancel unrelated jobs.
- Reinstall retaining the protected credential/local DB may restore the same identity. A replacement installation without those records requires operator-mediated rebind or a new identity plus historical-data reconciliation.
- Rebind invalidates the former installation's authority and records the operator action. Never authorize rebind based only on a copied UUID, hostname or SQLite file.
- Concurrent clone/session rejection and copied-DB-without-credential tests are required. Strong hardware-bound protection is not claimed by D6 and would require a separate design decision.

## 9. Review checklist and handoff

- [x] D1/D5/D6 explicitly approved by user.
- [x] Current identity/local-stop gaps checked against source.
- [x] Legacy/new compatibility matrix and fail-closed transition documented.
- [x] Pending results, immutable checksums and historical receipts preserved in migration design.
- [x] State dimensions, permissions and implementation ownership separated.
- [ ] User confirms this detailed contract before Task 12.
- [ ] Tasks 12–19 implement and verify it; production enforcement still requires separate approval.

Verification for this documentation-only task: source inspection, decision/spec cross-check, Markdown link existence and `git diff --check`. No runtime tests/builds were run for this change; Task 10 results are historical, not new evidence for authentication. No secrets are needed from the user for this task.
