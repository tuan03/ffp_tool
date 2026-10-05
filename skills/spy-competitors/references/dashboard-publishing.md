# Publish research to FFP

At the end of a registered-store analysis, call `ads_publish_competitor_research` with `{ research: ... }`. This is an authorized research-record write, not ad-watchlist synchronization or campaign execution. Always inspect the live tool schema.

The research object requires:
- `storeId`: exact Gateway connection selected for this run; never use another store as fallback.
- `shopDomain`: exact registered Shopify domain from `ads_list_stores`, not the public custom domain. Backend checks the mapping.
- `storeDomain`: canonical public domain, lowercase, no protocol or path.
- `observedAt`: ISO-8601 timestamp for this run, with timezone.
- `scope`: `{ products: string[], market: string, currency: string, excluded: string[] }`.
- `selected`: zero to ten verified brands. Each has `name`, `domain`, `productGroup`, `score`, `scoreBreakdown` (`product`, `customizationModel`, `audience`, `price`, `themes`), `confidence` (`high` or `medium`), `evidence` (`url`, `note`), and `adStatus` (honest concise status in the user's language). Scores must sum, total >=65, product >=30. Do not pad an empty/partial run.
- `limitations`: string array, including any missing ad evidence. Describe the analysis limitations, not stale statements such as “dashboard not updated” after publishing succeeds.
- `websiteDerivedHypotheses`: array of `{ title, basis, hypothesis }`; never label website hypotheses as verified ad performance.

Keep full rejected/pending lists and ad evidence in the local run JSON. Send the compact display payload above to the dashboard. Never send credentials, personal customer records, or HTML. HTTP(S) source URLs only.

Read back using `ads_get_competitor_research({storeId})` and verify domain, observation time, and selected count. Report successful publication separately from ad availability. The Spy Competitors tab polls research every 15 seconds while open. Saving a new report replaces the store's current displayed report; older observation dates are rejected. Retain full timestamped local research as history.

If publication fails, retain local results and report the failure. Retry only after correcting the reported mapping/schema/connection issue. Do not bypass missing tools with copied credentials or direct edits to backend storage. Unregistered public stores can still be researched locally but cannot be published until mapped.


For ad collection, also publish `verifiedAds`, `adCollection`, and `adInsights` as described in [ad-collection.md](ad-collection.md). Every published ad must reference a selected brand, an observed numeric archive/Page ID, a same-brand product evidence URL, and matching collection counts. The dashboard then reads this verified snapshot instead of the legacy watchlist report, preserving video/image URLs and source timestamps. The displayed ads also refresh every 15 seconds while the tab is open. Current snapshot retrieval does not make new paid provider calls; a new collection run is needed to refresh source status or expired media.

For a mixed carousel, `verifiedAds[].selectedCardIndices` selects zero-based indices in the original `ad.cards` array. Save the unmodified source cards, review the selected media and destination, and explain partial display in `qualificationReason`. The library projects only selected cards and labels original positions. Preserve ACTIVE/INACTIVE status and expanded-market caveats.
