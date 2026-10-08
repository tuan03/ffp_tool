# Partial Amazon family recovery

Crawler hiding/archiving is not a registry reset. A family may contain live
Shopify products, retained SEO/Review items, and products removed from SEO Queue.
Recovery is store-scoped and audited through `POST /api/v1/asin-families/recover`.

## Operator flow

1. Select the correct Shopify store and run the ASIN preflight.
2. Use **Kiểm tra / mở cào lại ASIN**, supplying an audit reason, when new Amazon
   data is needed. Alternatively retry eligible products from retained crawl data.
3. The Coordinator verifies known product IDs on Shopify and searches exact ASINs
   again. It does not accept deletion evidence supplied by the browser.
4. Only operator-cleared SEO products without live Shopify matches, or terminal
   products whose recorded Shopify IDs are explicitly absent, are recoverable.
5. Start a new crawl after a recrawl release. Existing Shopify products and retained
   sibling pipeline records are acknowledged but never handed to SEO again.

`product: null` in a successful `products.get` response is evidence of deletion.
HTTP errors, malformed responses, unavailable filters, permissions and rate limits
are not. A replacement Shopify product with the same ASIN prevents recovery.

## Safety and compatibility

- Recovery rejects active family crawl tasks, selected pipeline claims and another
  retained record for the same selected source. Job creation takes the same family
  registry locks before admitting a new crawl.
- Synced siblings and pending SEO/Review siblings keep their data and links.
- Superseded crawl records are retained with a `recrawlReleased` marker and audit
  events. Independent recovery audit records survive normal job-history retention.
  Registry backfill must not restore their obsolete Shopify pointers.
- Obsolete active links are removed only for verified recoverable sources; their
  previous Shopify result remains in the retained record/audit history.
- Retrying creates a new SEO source revision and Shopify sync generation. Recrawling
  creates a new pipeline item and request namespace, preventing old cached results
  from replacing the intended new processing run. Image processing remains enabled.
- No new environment variables or database migrations are required. Recovery uses
  the existing server-side `SHOPIFY_GATEWAY_URL` and `GATEWAY_AUTH_TOKEN`.
- `seoSourceRevision` on internal claims, `inputSyncedAsins` in preflight families,
  and `skippedExistingPipeline` on handoff summaries are additive; older clients
  can ignore them. A requested child ASIN with a historical mapping but no current
  exact Shopify match requires verification even when siblings still exist.
- This does not delete Shopify products or hard-delete crawl/audit history. If old
  history is already gone, verified orphan registry/link records can still be
  released for recrawling. Retrying SEO from saved data requires retained products.

Focused verification: `engine.tests.test_family_recovery`,
`gateway/__tests__/amazon-asin-preflight.test.ts`, and crawler presentation/service
tests. Live Shopify writes are intentionally excluded from automated fixtures.
