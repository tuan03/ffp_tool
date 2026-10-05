# Task 05 — durable upload receipts and checksum conflicts

- Baseline: `e1a4a93`, working branch `cua_pro` as explicitly requested (exception to the standard task-branch workflow).
- Original specification: sections **19, 30–31**, limited to server upload receipts, duplicate delivery and conflicting content. This does not complete those entire sections.
- Dependency: Task 04 accepted through the user's instruction to proceed.
- Status: accepted on 2026-10-04. User reported successful testing and explicitly authorized Task 06. Implementation commit: `e97b4df`. Verification below records the Task 05 handoff; subsequent agent integration is in the Task 06 report.

## Scope and behavior

Coordinator code was changed, not just tests. No agent, UI, Shopify integration, credentials or running container was changed.

Previously, final-result duplicates could receive an ACK without verifying unchanged content. Streaming duplicates relied on pipeline rows rather than a durable acknowledgement independent of raw-payload retention.

The new `crawler_upload_receipts` table stores the payload checksum and acknowledged response in the same transaction as result acceptance. It does not duplicate raw product payloads.

| Delivery | Behavior |
| --- | --- |
| First valid upload | Commit result and receipt atomically; return accepted response with `receiptId` and `checksum` |
| Same identity and exact payload again | Return `duplicate` with the same receipt ID and checksum, without another pipeline insertion |
| Same identity but changed payload | Return HTTP 409 with `detail.code = UPLOAD_CHECKSUM_CONFLICT`; preserve original result |
| Already receipted upload retried after lease expiry | Replay its historical ACK only; no lease renewal, task reopening or new write |
| Expired writer with no receipt | Existing current-lease fencing rejects the upload |
| Failure before transaction commit | Neither a successful receipt nor a completed result survives |

The server derives the receipt identity by hashing upload kind, task ID, client ID, lease ID and, for streaming, canonical product source key. This is the existing-protocol adapter, not yet an independently generated agent `result_id`. Task 06 will implement the local outbox/identity contract and consume receipts. Clients must preserve the exact retry payload; changed metadata also changes its checksum. A claimed `productChecksum` cannot bypass hashing of actual content.

Receipts serialize same-task uploads under the existing PostgreSQL task row lock. Concurrent final uploads are tested explicitly. Cross-task same-product concurrency and live transport interruption remain outside this test's proof.

## Migration and compatibility

- Coordinator migration version advances from 1 to 2 with an additive receipt table. Migration is repeatable and preserves existing tasks/leases.
- This turn migrated only disposable test schemas. The application database and running Docker images remain unchanged.
- Existing final results can lazily obtain a receipt after verifying their stored transport checksum, even if raw payload was pruned. HTTP handlers validate that checksum against the incoming body.
- Legacy streaming data without a receipt still requires a current lease and matching stored product content. Pruned legacy content cannot be safely acknowledged as identical; the server rejects rather than inventing evidence.
- Receipts currently live as long as their task. Existing task/history deletion removes them. Independent retention/tombstone policy is a later task, not indefinite deduplication.
- Success fields are additive; checksum conflict is a newly explicit HTTP outcome. No route, environment variable or dependency was added.
- Old server binaries reject migration version 2. Do not simply roll an application image back against a migrated database; plan a compatible rollback/restore at deployment time.

**Do not rebuild/deploy this partial server change with the existing agent yet.** Its upload handling currently treats HTTP 404/409 as cancellation and can remove local spool data. Tasks 06–07 must preserve results and distinguish delivery dispositions before the integrated Task 10 gate. This turn does not claim end-to-end outbox safety.

## Changed files

- `engine/distributed/coordinator_models.py`: receipt model.
- `engine/distributed/coordinator_migrations.py`: additive version 2 migration.
- `engine/distributed/coordinator_store.py`: transactional receipts, replay, checksum conflicts and scoped receipt cleanup.
- `engine/distributed/coordinator_server.py`: structured HTTP conflict mapping.
- `engine/tests/test_upload_receipts.py`: receipt, rollback, migration and concurrent-upload cases.
- `engine/tests/test_coordinator_migrations.py`, `test_distributed.py`: migration and HTTP contract regressions.
- `scripts/audits/audit_lease_baseline.py`: `--receipts` mode against isolated PostgreSQL schemas.
- Audit checklist, upgrade-plan status and Task 04 report: progress bookkeeping.

Engine paths above are under `src/modules/amazon-crawler/`. Only the Coordinator child process and its PostgreSQL schema are affected when eventually deployed; topology remains three production containers.

## Verification and user test

From the repository root, with the existing local PostgreSQL container available:

```powershell
python scripts/audits/audit_lease_baseline.py --receipts
```

Expected:

```text
RUN 1: receipt tests=9, failures=0, skipped=0
RUN 1: own test schema removed and absence verified
RUN 2: receipt tests=9, failures=0, skipped=0
RUN 2: own test schema removed and absence verified
PASS: PostgreSQL upload receipts verified twice; Task 05 awaits user acceptance.
```

The harness creates unique `ffp_audit01_*` schemas with `public` excluded from the search path, runs nine cases twice, and removes only its own schemas. It reads local source, so rebuilding Docker is not needed. It does not crawl Amazon or call Shopify.

Coverage: receipt replay after store recreation; immutable final content; streaming replay after expiry/raw cleanup; forged claimed checksum; stale unreceipted writer; legacy final backfill; transaction rollback; repeatable v1-to-v2 migration; concurrent final uploads. Store recreation is not proof of a full container/OS crash-recovery test.

Fresh verification:

- Initial five focused cases before implementation: three failures, one error, one pass.
- PostgreSQL `--receipts`: nine cases passed in each of two fresh schemas, zero skips, both cleanups verified.
- PostgreSQL Task 02 `--expect current-lease`, Task 03 `--streaming`, Task 04 `--mutations`: passed twice each after runtime edits.
- Focused HTTP acceptance/duplicate/conflict test: passed.
- `npm test`, `npm run typecheck`, `npm run build`: exit 0. General-suite environment skips are not coverage evidence; the dedicated PostgreSQL receipt suite did run without skips.
- No mock/runtime selection change; `build:mock` was not required.
- `git diff --check`: passed. `docker ps` confirmed the existing application containers remain healthy. A plain `docker compose ps` without the local environment file could not interpolate `POSTGRES_PASSWORD`; no configuration was changed, and this is not a failure of the running containers or receipt tests.

Logs are local only: `%TEMP%\ffp-audit05-npm-test.log`, `%TEMP%\ffp-audit05-typecheck.log`, `%TEMP%\ffp-audit05-build.log`.

## Acceptance gate

- [x] User reported successful testing (no raw output attached in this turn).
- [x] User accepted the handoff and authorized Task 06.

No push, rebuild, restart, VPS deployment or release was performed during Task 05.
