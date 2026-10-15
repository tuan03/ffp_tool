# Crawler active SEO deduplication

The crawler and Codex queue share PostgreSQL. Active worker reservations
(`seo_worker_jobs.pipeline_active`) are authoritative even when a crawler history
record or ASIN registry alias is missing. This behavior is store-scoped and uses
exact product/source-variant ASINs, never every child of a parent family.

## Flow

- Family resolution returns optional `activeSeoAsins` containing only requested
  ASINs already reserved in SEO Queue/Review. Preflight excludes those inputs and
  still permits a new sibling or a parent discovery seed. Running crawl tasks
  continue to block their family until they finish.
- Streaming uploads and final-result uploads check active SEO identities before
  creating another product pipeline item. The existing
  `skippedExistingPipeline` counter records these skips once per source key.
- Before normalization/enqueue, the worker calls the pipeline-key-protected
  `POST /api/v1/internal/product-pipeline/{id}/skip-existing-seo`. Only the
  Coordinator decides whether the claimed item's exact ASINs are covered by
  existing jobs. A skip completes only the duplicate item, without attaching
  the existing SEO job or granting another Shopify publisher ownership.
- PostgreSQL enqueue checks exact ASIN reservations under the existing queue
  transaction lock. A verified duplicate returns HTTP 409 with error code
  `ALREADY_IN_SEO_PIPELINE`; the worker rechecks through the Coordinator and
  settles it as a skip rather than retrying a generic HTTP 400.

New crawler SEO snapshots carry `crawlerPipelineItemId` as operational metadata.
This prevents a lost enqueue response from causing a retry to skip its own job.
Generation inputs and their hashes remain unchanged. Existing queue jobs are not
cancelled, reassigned, or republished by duplicate handling.

If one product mixes reserved and genuinely new variant ASINs, the complete
product is not silently discarded. A collision requiring a decision about that
mixed group is reported as `SEO_PIPELINE_IDENTITY_CONFLICT` without automatic
retry. Other independent products can continue. Legacy snapshots without exact
ASINs are not assumed to match solely because a family/source label resembles
another product.

## Indexed handoff and uncertain enqueue recovery

Gateway startup now performs an additive, transactional projection migration:
`seo_pipeline_identities` stores job/source/revision/owner metadata and
`seo_pipeline_asins` has a `(store_id, asin, job_id)` primary key. Existing active
jobs are backfilled once, with a version marker. Database triggers update the
projection in the same transaction as queue writes, imports and worker
reactivation; eligibility still joins live `pipeline_active` and job status.
Closed/cancelled history does not reserve an ASIN. The parent is never expanded
into sibling reservations. No payload JSON is read on the indexed lookup path.

Coordinator upload/final-result/duplicate checks select only the requested exact
ASINs. Gateway enqueue uses the same projection under its existing transaction
lock, preserving the concurrent-enqueue guard without a store-wide JSON scan.

After an uncertain enqueue failure, the Pipeline makes three bounded receipt
lookups (immediate, after 500 ms, after 1500 ms). The pipeline-key-protected
`POST /api/v1/internal/product-pipeline/{id}/recover-external-seo` attaches a job
only when store, owner item, source key and source revision match uniquely and
the caller still owns the item. A subsequent claim also checks for its previous
receipt before repeating normalization or Shopify checks. Recovery does not
adopt another item's SEO job, create a second job, or run Shopify writes.
Successful handoff/recovery clears old timeout errors and preserves normalization
metadata. REVIEW_READY receipts are immediately eligible for continuation.

Run the local synthetic comparison with
`node --import tsx scripts/benchmark-seo-handoff.mjs`. It creates 400 jobs in an
in-memory PostgreSQL-compatible database, compares the previous JSON scan to an
indexed exact lookup and closes the database; it never uses production data.
Its timing is a local diagnostic, not a production latency guarantee.

No new environment variable, dependency, or Windows Agent update is required.
Deploy Coordinator, Gateway and Pipeline Worker together. Allow the one-time
startup backfill to finish before accepting traffic; do not independently
create/empty projection tables or bypass the normal queue initialization.
Standalone crawler databases without the Gateway queue tables retain their
existing registry checks; queue enqueue remains the final reservation guard.
Pre-upgrade standalone queue schemas retain the legacy read until the atomic
Gateway migration commits; they are compatible but do not receive the speedup.

### Local verification (2026-10-15)

- Real PostgreSQL 17: all 12 queue integration tests passed, including concurrent
  exact-child reservations, store isolation, migration rollback and legacy import.
- Focused projection/recovery tests cover backfill, reactivation, payload changes,
  transaction rollback, cancelled jobs, ownership/revision fences, endpoint auth,
  immediate continuation for finished receipts and clearing stale timeout errors.
- Two synthetic 400-job / 27.63 MB comparisons: legacy scan 153–218 ms, indexed
  lookup 2.73–3.25 ms (~47–80x). These are local query benchmarks only.
- Typecheck, production build and mock build passed. Full `npm test` reached
  Gateway but failed its pre-existing Ads MCP audit fixture (`Super Admin`
  versus `Test Media Buyer`); no unrelated Ads code was changed.
- The default engine run hit the existing packaged-agent config test because it
  reads the developer's LOCALAPPDATA connection. That test passes with an isolated
  LOCALAPPDATA; the isolated full engine run passed (703 tests, 23 skipped).
  Web passed (1097, 14 skipped), tooling passed (80, 1 skipped), review-image
  passed (34 plus extension checks), and Pinterest passed (24).
  Production data and the running Windows Agent were not changed.
