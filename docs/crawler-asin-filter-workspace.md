# Persistent crawler ASIN filter

The crawl workspace keeps its Shopify ASIN filter separate from the crawl input.
On desktop, the filter sits beside the crawl form; on smaller screens it stacks
below it. Collection and pricing controls remain open and usable in the crawl
form. The filter never starts a crawl or replaces the crawl input.

Workflow: paste ASINs into the filter, check the selected Shopify store, open each
missing ASIN's **View** link in Amazon, then **Copy** individual ASINs into the crawl
input and choose the relevant collection. Bulk copy and TXT download remain
available. Matching still uses exact `custom.amazon_asin` values, including draft
and archived Shopify products; family expansion and crawl preflight are unchanged.

Drafts and the last successful result are stored per store in browser localStorage
(`ffp:crawler:asin-filter:v1:<encoded-store-id>`). Reload, workspace navigation,
crawling, and switching stores do not clear the saved list. Editing the filter
input, failed checks and cancelled checks retain the previous successful snapshot;
the timestamp and warning distinguish that snapshot from a fresh check. A completed
explicit recheck replaces it. **Xóa danh sách** asks for confirmation and clears
only the selected store's filter, never the crawl input or backend data.

Storage is browser/origin-specific, not shared between users or devices. Invalid
saved records are ignored; unavailable/full storage produces a visible warning.
Checks are aborted and obsolete responses ignored on input change, clearing, store
switch, and unmount. No routes, backend contracts, dependencies or environment
settings have changed.

Focused checks:

```powershell
npx tsx --test src/modules/amazon-crawler/__tests__/asin-filter-workspace.test.ts src/modules/amazon-crawler/__tests__/shopify-asin-filter.test.ts
```

Browser tests use loopback-only UI URLs. Provide `FFP_CRAWLER_UI_TEST_URL` for an
isolated mock UI and `FFP_CRAWLER_REAL_UI_TEST_URL` for a development UI. They mock
Shopify responses and Coordinator discovery/polling, without production writes.
Set `FFP_CRAWLER_UI_BROWSER_CHANNEL=chrome` to use an installed Chrome when the
Playwright Chromium distribution is unavailable.
