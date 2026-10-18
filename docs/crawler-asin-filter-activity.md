# Store-scoped ASIN filter activity

The crawler filter combines a complete Shopify `custom.amazon_asin` scan with a
read-only Coordinator ownership lookup. Shopify matches remain exact, including
draft/archived products. `missingAsins` still means absent from that Shopify scan;
the UI only offers members whose current activity is `available`.

`POST /api/v1/asin-families/activity` accepts `{storeId, asins}` (1–200 ASINs) and returns
`{storeId, entries}` with one entry per unique input. Each entry has `asin`,
`parentAsin`, and `status` (`available`, `crawling`, `processing`, `attention`).
Optional `relatedAsin`/`jobId` describe the active crawl. It uses the same existing
Coordinator access boundary as family resolution; there is no Shopify/Amazon
write and no migration, environment variable, or new dependency.
Optional `shopifyRevision` records the last confirmed sync timestamp as a change
marker, never as proof of current Shopify existence. A changed marker forces a
Shopify recheck even if the whole crawl/sync finished between two polls.

Ownership comes from active crawl tasks, exact received product/source-variant
aliases, and active SEO identities in the shared database. Historical registry
records alone never reserve an ASIN. Deleted/cancelled/completed crawler items
are excluded. Operator-cleared SEO failures and authoritative cancelled SEO jobs
are excluded even before the worker observes Queue removal. Other failed or
reconciliation items appear separately as `attention`, not as successful work.
Known family membership only reserves siblings temporarily while a crawl task
is active; completed/failed tasks do not imply every sibling was received.

The client batches larger inputs, rejects incomplete/wrong-store responses, and
polls activity every 10 seconds while visible, without overlapping polls or
repeated catalog scans. When ownership disappears it rechecks Shopify to
distinguish successful sync from Queue cleanup. Stored per-store drafts/results
survive reload, but server activity must be revalidated before selecting/exporting
ASINs. Failures disable selection/export rather than classify unknown ASINs as
available. Editing, clearing and switching stores invalidate in-flight work.
Existing crawl preflight remains the final guard against concurrent changes.

Unknown families are not fetched from Amazon during filtering. Their siblings
become known as the Agent uploads actual products. No Agent update is needed.

## Verification

- `shopify-asin-filter.test.ts`: combined filtering, batching, invalid responses,
  abort, and lightweight refresh.
- `test_active_seo_duplicates.py`: exact/store-scoped ownership, partial families,
  cleared Queue, retained variants, cancelled/failed tasks and API validation.
- `asin-filter-activity-browser.test.ts`: real component and services with mocked
  HTTP only; polling, reload, new pasted batches, Queue cleanup, sync, outage,
  store switching. Run against an isolated Vite dev server with
  `FFP_CRAWLER_UI_TEST_URL`; optionally set `FFP_CRAWLER_UI_BROWSER_CHANNEL`.

Branch exception: implemented directly on `cua_pro` at the user's explicit request.
Deployment requires the Coordinator and web changes together. This work does not
push branches, deploy production, or change existing Queue/Shopify data.

Local QA: Web 1,117 passed / 15 skipped; the activity browser scenario was also
run explicitly and passed. The focused Coordinator suite ran 33 tests / 1 skipped.
The broader Engine run passed 723 tests / 23 skipped before the final additional
activity cases (covered by the focused rerun). Typecheck and production build
passed. The aggregate `npm test` did not finish: its Gateway stage repeated the
existing `McpUserManager manages users, verifies tokens, and records audit logs`
failure and remained running, so it was stopped. Do not interpret the focused
results as an all-green aggregate suite.
