# SEO Versioning rollout and recovery runbook

This runbook operationalizes the versioning phases in
`todo/README_FFP_SEO_VERSIONING_TEAM_PLAN.md`. PostgreSQL is authoritative;
Shopify `custom.seo_version` is only a mirror and write fence.

## Authorization boundary

- Jeminise is the READ-only pilot. Baseline observation and history inspection
  are permitted; Shopify mutations are not.
- Keep the global publish switch and every store `write_enabled` flag off until
  a separately authorized staging/clone WRITE names the store and product.
- Never run destructive, concurrency, or fault-injection tests against the VPS
  production database.
- A fixture, local PostgreSQL result, or live READ is not evidence of a
  successful production publish.

## Evidence record

For every rehearsal, record the Git commit, environment, store, product GID,
database schema, operator, start/end time, commands, counts, hashes, and one of:

- Deterministic unit fixture.
- PGlite integration.
- Real local PostgreSQL integration.
- Local/staging Shopify READ.
- Controlled staging/clone WRITE.
- Production live observation.

Keep secrets, database URLs, Shopify credentials, and bearer tokens out of the
record. Store screenshots only for authorized visual scenarios.

## 1. Preflight and backup

1. Verify the deployed commit contains SEO Content V2 and record the existing
   schema migration rows.
2. Inventory unresolved write intent in `seo_publish_operations`, browser
   `gpt_sync`, Review state, worker leases, and pending revisions. Do not cut
   over while an operation could have written remotely.
3. Inventory the bounded pilot catalog and remote `custom.seo_version` values.
   Report missing, malformed, or mismatched values; do not repair by guessing.
4. Confirm versioning READ and WRITE are off for the target store and the
   global backend publish switch is off.
5. Create a PostgreSQL custom-format backup with an operator-managed secret,
   not a credential embedded in this repository:

   ```text
   pg_dump --format=custom --file=<timestamped-backup>.dump <database-connection>
   Get-FileHash <timestamped-backup>.dump -Algorithm SHA256
   ```

6. Create a manifest containing the backup hash plus counts for migration,
   product, snapshot, version, draft-base, drift, rollback-request, operation,
   and receipt tables.
7. Restore into a new isolated database and compare every manifest count plus
   ordered snapshot content hashes and `(store_id, product_id, version_number)`.
   A backup is not accepted until this restore comparison passes.

## 2. Additive migration with flags off

1. Deploy the schema/application while all versioning flags remain off.
2. Apply the numbered migrations. Run initialization a second time; it must be
   idempotent and must not change the recorded migration names.
3. Verify foreign keys, uniqueness/check constraints, and immutable-table
   triggers. Confirm existing feed, Review, Auto-SEO, mock runtime, and MCP
   behavior remains available.
4. Confirm lifecycle/history endpoints report a disabled capability instead of
   silently enabling writes.
5. If migration readiness fails, leave flags off, roll back the application
   release, preserve additive tables for diagnosis, and restore the database
   only with explicit incident approval.

## 3. Jeminise READ-only pilot

1. Enable `read_enabled` only for Jeminise; leave `write_enabled` and the global
   publish switch off.
2. Run catalog discovery as a dry run and compare product/media totals with the
   Shopify GraphQL response. Pagination must reach the final media page.
3. Backfill in bounded, resumable batches. Refreshing or receiving a duplicate
   observation must retain exactly one v0 per `(store_id, product_gid)`.
4. Sample immutable snapshots, canonical hashes, Media GID-to-alt mappings,
   public/archive/draft state, and URL history. External content changes must
   create drift evidence without changing the committed version.
5. Enable history API/UI READ and inspect lifecycle, pagination, server-side
   diff, safe errors, and store isolation. Browser traffic must contain neither
   direct Shopify Admin requests nor credentials.
6. Generate and regenerate drafts. Each job must retain its base version/hash;
   current version must remain v0.
7. Reconcile observed count/hash differences before expanding the pilot. Do not
   enable WRITE as part of this runbook step.

## 4. WRITE cutover rehearsal (separate authorization required)

1. Use a named staging/clone store and product. Reconfirm Publisher/operator
   identity, a verified backup, zero unresolved write intent, and authorization.
2. Enable per-store READ, then per-store WRITE, then the existing global
   backend publish switch. The browser publisher must fail closed with
   `BACKEND_PUBLISH_REQUIRED`.
3. Execute one canary: v0 → draft → human approval → durable backend apply →
   complete read-back → v1. Verify all intended fields, the Shopify mirror, one
   operation receipt, one authoritative v1, and immutable v0.
4. Exercise no-change, stale base, partial read-back, lost response, process
   restart, and two-publisher concurrency. Only complete verified read-back may
   commit a version; uncertain cases remain reconciliation-required.
5. Exercise external drift and rollback preview. An approved rollback publishes
   forward as vN+1 with `source=ROLLBACK` and `restored_from_version_id`; it
   never decrements or edits history.
6. Observe locks, query counts, error rate, and reconciliation queue for the
   lead-defined window before any expansion.

## 5. Reconciliation

1. Stop retries that could duplicate a remote mutation and retain the original
   operation/idempotency key.
2. Read Shopify again, including title, description HTML, SEO fields, every
   relevant Media GID alt, published AEO metafields, and mirror version.
3. Compare the canonical remote hash with the operation's frozen before/after
   evidence and authoritative current version.
4. If the full intended state is verified, resume the durable state machine to
   commit exactly one receipt/version. If remote state is partial, conflicting,
   or unknown, keep the operation blocked and record per-field evidence; do not
   mark success or resend blindly.
5. Re-run the affected focused test and full regression after any fix.

## 6. Feature rollback and incident recovery

1. Turn off per-store WRITE, then the global publish worker. Disable new apply
   actions while keeping version/history records readable.
2. Drain or reconcile operations that may already have written. Do not use the
   legacy browser allocator for converted stores.
3. Roll back the application release if required, but preserve additive ledger
   tables, immutable snapshots, operation evidence, and audit events.
4. Restore PostgreSQL only from the verified backup into an isolated database
   first; production restoration requires incident approval and a new manifest.
5. Revert Shopify content only through an approved forward rollback publish.
   Never update/delete version rows or overwrite an historical snapshot.

## 7. Required verification gates

Run focused suites first, then the full repository gates from a clean diff:

```text
npx tsx --test gateway/__tests__/seo-version-*.test.ts
npx tsx --test gateway/__tests__/seo-publish*.test.ts
npx tsx --test gateway/__tests__/seo-revision*.test.ts
npx tsx --test gateway/__tests__/seo-worker-mcp.test.ts gateway/__tests__/seo-input-contract-v2-leakage.test.ts
npm test
npm run typecheck
npm run build
npm run build:mock
```

Set `SEO_QUEUE_TEST_DATABASE_URL` only to the dedicated local/test PostgreSQL
database when running the real-PostgreSQL scenarios. A skipped database test is
not a PostgreSQL pass.

Chrome QA follows automated green results. For the READ-only Jeminise pilot,
verify store selection, GraphQL catalog load, one persistent v0, draft-still-v0,
source/proposed/history separation, safe loading/empty/error states, console,
and browser network safety. WRITE screenshots (v1, conflict/reconciliation,
rollback v2) require the separate staging/clone WRITE authorization above.

The rollout is blocked if any required gate fails, any possible write remains
unresolved, restore evidence is absent, store isolation fails, the MCP surface
contains publish/admin tools, or a browser can call Shopify Admin directly.

## 8. Current automated evidence map

| Requirement | Automated evidence |
| --- | --- |
| Additive/repeatable migrations, v0, store isolation, idempotency, no-change, immutable history, rollback provenance | `seo-version-persistence.test.ts` |
| Canonical hashing and complete media pagination | `seo-version-snapshot.test.ts`, `seo-version-baseline.test.ts` |
| Stale-base fence, verified exactly-once commit, no-change, lost response, partial read-back, rollback vN+1 | `seo-version-publish-lifecycle.test.ts` |
| Server-authoritative lifecycle/history/diff, authorization, rollback draft only | `seo-version-http.test.ts`, `seo-version-diff.test.ts` |
| Draft base integration, regeneration stays v0, browser publisher cutover fence | `seo-version-qa.test.ts` |
| MCP remains draft-only and SEO Content V2-only | `seo-worker-mcp.test.ts`, `seo-input-contract-v2-leakage.test.ts` |

Backup/restore, live Jeminise READ, Chrome inspection, and any controlled
staging/clone WRITE remain operational evidence and must be recorded separately;
they cannot be inferred from deterministic or PGlite tests.
