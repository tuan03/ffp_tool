# Amazon parent metafield identity

## Scope

Fix implemented on the user's ongoing `cua_pro` branch. Changes are limited to the Shopify sync adapter, crawler Pipeline Worker, legacy SEO Review orchestrator and their tests. No storefront records are backfilled by this change.

## Policy

- `custom.amazon_asin` keeps the product's exact Amazon ASIN.
- `custom.amazon_parent_asin` uses the normalized crawl product's `parentAsin`. The crawl input ASIN and SEO Review's display ASIN must not override it.
- Both single-product and batch adapters retain the optional `amazonParentAsin` option for source compatibility, but it is deprecated and ignored. A mixed-family batch keeps each product's own parent.
- Missing, blank or invalid parent metadata fails the existing sync preflight before Shopify mutations; the sync adapter no longer substitutes the child ASIN. An explicitly provided parent equal to the child remains allowed for standalone products.
- This fix does not re-discover Amazon families or change the crawler parser's existing fallback behavior. A syntactically valid stored parent is not independently verified against live Amazon during sync.
- Pipeline metafield policy version is now 3. The outgoing normalized parent participates in the checksum before the no-op decision, and therefore in the idempotency request prefix. Existing sync/reconciliation guards still apply; the version change does not automatically resubmit completed items.

## Existing data

Queued/review products with their original parent metadata use the corrected value on their next normal sync; they do not need another crawl or SEO pass. Already published products require a separately approved, scoped metafield backfill using available crawl evidence. Do not recreate products or bypass reconciliation to repair metadata.

## Verification

Regression tests cover distinct input/child/parent ASINs, legacy override rejection, mixed-family batches, missing/invalid parent preflight, explicit standalone identity, actual legacy Review metafield requests, and the worker checkpoint policy. Tests use fixtures/mock gateways without Shopify writes.

Local verification on 2026-10-18: 41 focused sync/orchestrator tests and 2 worker checkpoint tests passed; tooling passed 81 tests (1 skipped); web passed 1,127 tests (16 skipped); typecheck and production build passed. Full `npm test` reached the existing failing Gateway `McpUserManager manages users, verifies tokens, and records audit logs` test and did not terminate; its own test process was stopped. The complete suite is not marked passing.

No route, database migration, environment variable, dependency or Windows Agent change is required.
