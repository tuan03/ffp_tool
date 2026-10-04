# Task 13 — one-time Agent Key creation

## Scope and status

- Baseline `d1b636f`; branch `cua_pro`, retained by user instruction instead of per-task branching.
- Original specification **3, 23–24**: operator key creation, one-time disclosure, persisted verifier and metadata. Enrollment, credential validation on worker requests, rotation/revocation and UI lifecycle are not completed by this task.
- Task 12 accepted through the user's instruction to advance; no additional manual-test transcript supplied.
- Coordinator API/model, additive migration, tests and audit documents only. No production enablement, Nginx/Gateway change, installer, UI, dependency or environment change.
- Implementation awaits user acceptance; Task 14 has not started.

## Contract

Routes are registered **only** when the Coordinator factory receives the Task 12 `operator_credentials`. The default legacy application exposes neither route; it returns 404 rather than creating an anonymous key-management API. The operator boundary protects both routes; an Agent Key/Bearer token is not operator authorization.

| Route | Behavior |
| --- | --- |
| `POST /api/v1/agent-keys` | Valid operator creates one key; 201 returns raw `key` and metadata once, after transaction commit |
| `GET /api/v1/agent-keys?limit=50&offset=0` | Metadata only, deterministic ordering, limit 1–100; no raw key or verifier |
| `GET /api/v1/agent-keys/{id}` | No raw-key retrieval endpoint; not implemented |

Create body:

```json
{
  "requestId": "00000000-0000-4000-8000-000000000001",
  "name": "Windows crawler 01",
  "maxWorkers": 2,
  "crawlers": ["amazon"],
  "environment": "test",
  "expiresAt": "2030-01-01T00:00:00Z"
}
```

This is a shape example, not an instruction to create a production credential. Supply a fresh request UUID and a future, timezone-aware expiry for a real request. Unknown fields are rejected. Name is bounded/nonblank; workers must be a strict positive PostgreSQL integer, not a boolean; crawler permissions are a unique nonempty subset of `amazon`/`pinterest`; environment is explicitly `test` or `production`. Capacity and expiry are persisted policy, **not yet worker-enforced**. Effective capacity will also be bounded by server/runtime limits in enrollment and dispatch tasks; this integer bound is not a supported fleet-size claim.

Key format contains a nonsecret UUID identifier plus 32 cryptographically random bytes encoded with URL-safe base64. PostgreSQL stores SHA-256 of the complete high-entropy token, not plaintext or reversible encryption. Password-style low-entropy key input is not accepted. Keys initially have `status=unbound`, no agent identity and no last-use timestamp; Task 14 owns identity binding. Expiry is stored independently of lifecycle status and must be enforced by future auth consumers.

Responses use `Cache-Control: no-store`; creation also uses `Pragma: no-cache`. No raw key is put in a URL, log, audit row or environment example. Metadata is built from an explicit field allowlist; ORM objects are never serialized wholesale.

## Lost responses and transactional audit

- `requestId` has a database unique constraint. Sequential or concurrent repeats produce one row, not multiple keys.
- A repeat returns `409 AGENT_KEY_ALREADY_CREATED` plus the nonsecret key ID. It never regenerates/discloses the original raw key, even when the first response was lost.
- Do not blindly retry with a fresh request ID: that intentionally creates another credential. If the raw response is lost, operator-mediated lifecycle recovery is needed; rotate/revoke UI/API arrives in Task 18. The inaccessible key remains unbound. This is a reason not to enable this partial workflow in production yet.
- Key creation and assignment of its target ID/reason to the authorization audit row share a transaction. Creation requires the server-generated authorization audit reference, never a client-supplied actor.
- The Task 12 middleware preserves the `AGENT_KEY_CREATED` reason when recording the HTTP outcome. If the final outcome write fails after commit, its existing unknown-outcome response applies; raw keys cannot be recovered from the database.

## Persistence and compatibility

Migration **v4** adds `crawler_agent_keys` with key ID, unique creation request ID, verifier, name, creator, timestamps, binding/status and permission metadata. Existing audit/client/job/result tables are not rewritten. Upgrade is repeatable; an existing audit record is checked after a simulated v3 upgrade.

No migration was applied to the running application database. The next startup using the new code would apply v4. Older binaries that reject newer schema versions require a reviewed rollback/restore plan; do not remove migration markers to force a downgrade.

## User test and evidence

From the repository root, with Docker Desktop and the existing `ffp-local-postgres` running:

```powershell
python scripts/audits/audit_lease_baseline.py --agent-keys
```

Expected: **3 test methods, zero failures/skips per run**, two runs, each ending with verified deletion of its isolated audit schema. Final line:

```text
PASS: Task 13 one-time Agent Keys verified twice; runtime authentication not enabled.
```

The suite covers operator create/list, anonymous/agent denial, immutable request-ID retry, hash-only storage, no raw-key/verifier in metadata/audit, validation of expiry/capacity/permissions, and migration preservation. The PostgreSQL run additionally races two requests and expects exactly one 201 and one 409. The legacy-disabled route check uses its own temporary SQLite application; creation/race/migration use PostgreSQL, with no fallback if PostgreSQL is unavailable.

Local focused command:

```powershell
python -m unittest discover -s src/modules/amazon-crawler/engine/tests -t src/modules/amazon-crawler -p "test_agent_keys.py"
```

No actual key is printed by these commands or committed. Test keys/schema/temp directories are disposable. No live app/agent/container is restarted, and no VPS write or push is performed.

Fresh verification: `npm test`, `npm run typecheck`, `npm run build` passed. Crawler suite: 460 tests with 13 conditional skips; Review Image: 34 tests plus extension checks; Pinterest: 14 tests. Agent-key PostgreSQL checks passed twice, and the Task 12 operator PostgreSQL checks also passed twice after v4 (4 tests each, zero skips). Existing Vite externalization/chunk-size warnings remain; no mock composition change, so `build:mock` was not required.

## Remaining boundaries

- Task 14: idempotent registration and server-issued identity. Task 15: setup and OS credential storage. Tasks 16–17: HTTP/WSS enforcement. Task 18: rotate/revoke/rebind. Task 19: public routing, UI credential flow, rate limits and separately approved rollout.
- Existing public/no-auth runtime is unchanged. Do not mark agent authentication complete because creation tests pass.
- The user tests this backend task through the CLI harness; no key-management screen or production URL was added.
