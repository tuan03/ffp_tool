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

No new environment variable, dependency, schema migration, or Windows Agent
update is required. Deploy Coordinator, Gateway and Pipeline Worker together.
Standalone crawler databases without the Gateway queue tables retain their
existing registry checks; queue enqueue remains the final reservation guard.
