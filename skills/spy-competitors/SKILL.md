---
name: spy-competitors
description: "Discover and verify up to 10 product-matched competitor brands for any store, then analyze relevant ads using FFP Ads Intelligence MCP and public website evidence. Use for competitor spying, competitor discovery, or refreshing a store-specific competitor shortlist."
---

# Spy Competitors

Build an evidence-backed competitor shortlist for the requested store. Match actual products before analyzing ads. Never inherit another store's categories, market, exclusions, competitors, or MCP defaults.

## Invocation

Accept a store ID, brand, or public URL in natural language. Default to up to 10 distinct competitor brands and a discovery-plus-ad-analysis run. Examples:

```text
$spy-competitors STORE_ID
$spy-competitors https://store.example — market US, focus CATEGORY
$spy-competitors STORE_ID — refresh previous shortlist
```

These are Codex skill prompts, not shell commands or new MCP functions. If store identity is absent or ambiguous, ask only for the store; investigate everything else from available evidence. User-specified product focus overrides broader catalog categories for that run.

## Resolve the store and capabilities

1. Discover `ffp-ads` MCP tools and call `ads_list_stores`. Match the requested identity. Connections sharing a `shopDomain` can be proxy aliases; group them for identity but do not rewrite IDs by stripping suffixes. Prefer an explicit canonical connection when verified. Always pass the chosen `storeId` to every store-scoped call; never rely on a default store.
2. Call `ads_get_store_overview` for a registered store. Use verified market settings and business context, not ad metrics as a substitute for a catalog. A Shopify connection does not prove Meta or GA4 mapping exists.
3. Resolve the public storefront through observed redirects, official links, or verified configuration. A brand-name search match alone is provisional. An unregistered URL can still receive public-web research; mark MCP mapping unavailable and never substitute a different store.
4. Use connected MCP tools, not raw HTTP with credentials. If unavailable, disclose the limitation and perform public-web research where possible. Never copy credentials into skill files, reports, or prompts.

## Build a profile for this store

Read the homepage, collections, representative product pages, and shipping/FAQ pages. Record evidence URL and observation date for each conclusion. Capture:

- Canonical public domain, verified MCP store ID/domain mapping, and identity confidence.
- Exact product types and subtypes; selected focus for this run; excluded or adjacent categories.
- Personalization and made-to-order/retail model. Do not infer manufacturing or fulfillment model from appearance alone.
- Intended markets, currency, customer use cases, themes, and design positioning.
- Comparable product/variant prices when available. A displayed starting price is not a full-size set price or average order value.
- Unknowns, contradictions, and sampling limits. Product counts are not revenue shares.

User focus wins over inferred scope. Derive exclusions per store: rug is out of scope for a blanket-only store, but can be the primary scope for a rug store. Do not create a global blacklist of product words. A broad merchant can qualify through its verified relevant collection; unrelated products and ads must stay excluded.

Persist minimal non-secret research state outside the repository, under `${CODEX_HOME:-~/.codex}/skill-data/spy-competitors/<canonical-host>/`. Normalize the hostname to lowercase, remove a leading `www.`, allow only hostname characters, and never use a raw URL as a filesystem path. Keep one `profile.json` per store and timestamped research JSON per run. Preserve existing user overrides. Recheck identity and selected collections each run; refresh other evidence older than 30 days. Brand-specific profiles are research data, never additions to this skill's universal instructions.

## Discover and qualify competitors

Read [qualification.md](references/qualification.md) before selecting candidates.

Search public sources using the actual product subtype + personalization/model + market/use case. Use the available web search and page-reading tools; use Firecrawl when available, following its skill. If it returns a credit/auth error, disclose it and switch to an available web tool rather than looping or buying credits.

Begin with 20–30 distinct candidate brands where sources permit. Use product-specific queries, not only broad terms such as home decor. Search across each important selected product group, then verify first-party product/collection evidence. Existing watchlists and ads are leads, not pre-approved competitors. Deduplicate brands, domains, country storefronts, and known redirects. Exclude the user's own store and aliases. Marketplace listings are discovery leads unless the seller has a verifiable distinct brand and store.

Apply mandatory gates before similarity scoring. Keep separate accepted, rejected, and needs-verification lists. Select up to 10 highest-fitting verified brands from the researched pool; never claim global exhaustiveness. If coverage is insufficient, do one additional targeted search pass, then report a shortfall instead of filling slots with unrelated brands. Do not lower gates to reach 10.

## Analyze only relevant advertisements

Use the full collection sequence in [ad-collection.md](references/ad-collection.md): `ads_discover_advertisers` → verify official social links/provider aliases → `ads_fetch_competitor_page` → targeted `ads_search_live_library` → inspect landing pages and media → publish qualified ads and per-brand coverage. These tools support discovery outside the legacy watchlist. Prefer them for newly researched brands; inspect live schemas first. Do not stop after merely querying the old watchlist.

Use `ads_search_competitor_ads` for the selected store and supported filters; inspect its current schema before calling. In the inspected FFP implementation it filters ads already obtained for that store's competitor intelligence/watchlist: it is not guaranteed global brand discovery. `limit` counts ads, not distinct competitor brands. A `pageId` filter is not proof of page-to-brand identity. Verify advertiser/domain/product association from evidence.

Before treating an ad query as coverage of the shortlist, record for each selected brand: verified advertiser/Page identity and its evidence URL, source queried, retrieval outcome (`not_fetched`, `source_error`, `fetched_empty`, or `fetched`), retrieved count before product filtering, and qualified count after filtering. An empty existing-watchlist query does not cover newly discovered brands. If the connector cannot fetch those Pages, explicitly identify the missing capability; do not blame strict category filtering or imply no ads exist. Local `PAGE_REGISTRY` labels, test aliases, and benchmark fixtures are not identity evidence.

Use `ads_get_competitor_ad` for observed IDs when more detail is available. Recheck category at the ad/landing-page level even when the brand qualified. Only use `ads_get_competitor_creative_gaps` as additional evidence after checking that its competitors match the selected shortlist; discard unrelated watchlist conclusions. Do not assume a tool can accept a custom shortlist when its schema cannot.

For each brand, seek a small sample of relevant ads (normally up to 3) with source links or observed archive IDs, retrieval time, and media inspection level. Distinguish active status, first observed date, and actual campaign start date. If only text/thumbnail is available, do not claim to have inspected a video. Inspect card-level captions, destinations and media in mixed carousels; top-level keyword filtering alone is insufficient. Preserve `selectedCardIndices` and label partial-card display. Missing ads mean unavailable in the queried source, not that the brand does not advertise. Public ad libraries may supplement MCP when accessible; never invent page IDs, archive links, impressions, spend, sales, CPA, or ROAS.

Extract observed hooks, offers, customization presentation, formats, and landing-page continuity. Suggest original test ideas with a concrete difference from the reference. Ad longevity is a research signal, not profitability or causal proof. Publish the completed research to the store dashboard as described below. Other operations remain read-only: do not create experiments, generate paid assets, change live campaigns, edit backend ad watchlists, or start recurring monitoring unless separately requested. Respect provider limits; stop on quota failures and report coverage.

## Deliver and save

Report completion separately for competitor qualification, advertiser identity, ad retrieval, media inspection, and dashboard publication. Publishing ten website-qualified brands completes neither ad retrieval nor creative analysis. Diagnose the first incomplete step and preserve its evidence; do not call the entire spying workflow complete when only qualification succeeded.

Reply in the user's language. Provide:

1. Store identity and product/market scope, with source links and explicit assumptions.
2. Up to 10 unique brands: domain, matching product evidence, product-group coverage, similarity score breakdown, confidence, reason selected, and ad evidence status.
3. Relevant ad observations and 3–5 distinct ideas supported by available evidence. If no ads were inspectable, label ideas as website-derived hypotheses.
4. Rejected near-matches with reasons; unresolved candidates and missing-data limitations.

Save structured run JSON with `storeDomain`, `storeId`, `observedAt`, `scope`, `profileSources`, `candidates`, `selected`, `rejected`, `needsVerification`, `adCoverage`, and `limitations`. Each candidate includes evidence URLs, score breakdown, and disposition. Never save customer/order records or credentials. After saving local research, publish it to the FFP dashboard using `ads_publish_competitor_research`, then read it back with `ads_get_competitor_research`. Read [dashboard-publishing.md](references/dashboard-publishing.md) for the payload and verification. This saves research only; it does not change the backend advertising watchlist. For unregistered stores or an unavailable publish tool, keep the local report and explicitly report that dashboard publication is incomplete. Never claim the UI was updated based only on a local file.

On refresh, reload the matching store's last run, revalidate its evidence, and report additions/removals with reasons. Start a new profile for another store; do not reuse prior categories by default.
