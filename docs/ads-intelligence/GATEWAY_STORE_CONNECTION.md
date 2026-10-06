# Ads Intelligence: Gateway store connections

Ads Intelligence discovers Shopify stores from the Gateway StoreRegistry. It uses the same Shopify GraphQL client, token provider, proxy and throttling as the Gateway. A separate `SHOPIFY_ACCESS_TOKEN_<STORE>` is not required.

## Add or update a store

1. Use the existing Store management UI to register the Shopify domain, supported authentication and optional proxy. Verify the connection there.
2. Run the Gateway (`npm run gateway:start`) and web UI (`npm run dev:web`) in separate terminals, or use the existing combined development runner.
3. Open Ads Intelligence and select the registered store. The selector refreshes on window focus and every 30 seconds.
4. Shopify order metrics load independently. Missing Meta or GA4 configuration must not suppress Shopify results.

Vite's Store management handlers and the standalone Gateway use the same persisted configuration: `GATEWAY_STORES_FILE`, or `.runtime/stores.local.json` by default. This file contains local connection secrets and must not be committed. No credentials are returned by the Ads store-list endpoint.

## Contracts

- `GET /api/ads-intelligence/stores`: safe registry entries (`storeId`, `shopDomain`, `hasProxy`). Registry connection aliases are separate entries, not automatically merged.
- `GET /api/ads-intelligence/shopify?storeId=...`: paginated Shopify order summary through the selected Gateway connection.
- MCP adds `ads_list_stores` and `ads_get_shopify_summary` using the same connection layer.
- Gateway authentication applies to Ads REST endpoints. The Vite development middleware forwards its existing authentication for same-origin browser requests.
- Unknown stores, failed requests, invalid source mappings and incomplete pagination return errors, not sample metrics.

## Reporting scope and limits

The standalone Shopify summary covers the last 30 complete UTC dates. Reconciliation requests use the Meta reporting period and timezone. The UI shows the source and reporting period.

Eligible orders are paid, partially refunded or refunded, excluding test and cancelled orders. Values use shop currency and order totals (including tax/shipping) less current refunds for the selected order cohort. They are not Shopify Analytics Net Sales, cashflow-date revenue or accounting profit. Pagination is capped at 100 pages; reaching the cap fails instead of returning incomplete totals.

Shopify registration cannot infer Meta account/campaign ownership, GA4 property ownership, approved targets or costs. Those still require a verified Ads profile. A new Gateway store therefore immediately supports Shopify reads, but does not automatically enable cross-source reconciliation or financial recommendations.

This change does not complete the wider Ads roadmap: legacy competitor seed data, historical comparison logic and experiment workflows require separate verification before operational use. Development/production HTTP failures no longer fall back to frontend mock fixtures; explicit mock mode remains available.

## Verified display behavior

The KPI ribbon prefers the reconciliation period when that report is available, and displays only its Shopify source. Otherwise the independent Shopify period is explicitly labeled. A zero is retained when no eligible orders exist in the displayed period; it is not replaced by an order from a different period.

Live competitor reads require a configured provider and watchlist. Provider failures are errors; no calibrated benchmark fallback is used. The UI does not invent provider names, counts, costs or winning-ad labels. Aggregate Meta clicks versus all-source GA4 sessions are marked not comparable (`N/A`) rather than a loss percentage. Decision counts describe rule-generated suggestions, not reviewed conclusions.

## GA4 paid Meta acquisition

Reconciliation now includes `ga4.metaPaid`: sessions, ecommerce purchases, purchase revenue, GA4 timezone/currency, quality warnings and Meta-source sessions not classified as paid. The paid query requires both an exact case-insensitive Meta source allowlist (Facebook/Instagram/Meta aliases and domains) and `sessionDefaultChannelGroup = Paid Social`. Organic/referral traffic is not silently classified as paid. Custom UTM source aliases outside this allowlist remain outside the paid report until explicitly mapped.

The Data API computes filtered totals directly, without adding daily unique counts. A filtered-report failure preserves the all-source report and returns null paid metrics with an error status. An empty successful report is zero observed activity. Thresholding, sampling and other-row loss warnings are retained.

This is session acquisition scope, not validated campaign/ad attribution or a sequential funnel. The UI keeps source timezones visible and does not calculate a click-loss percentage across unmatched scopes/timezones.

Reference: [GA4 dimension and metric schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema).

## Reporting default: full available history

The user-selected default is now Meta `maximum` for account and campaign/adset/ad reports. Reconciliation passes the actual Meta start/end dates to GA4 and Shopify; it does not hardcode a calendar period. Independent Shopify reads use the shop creation date through today (UTC). Historical Shopify requests verify `read_all_orders` when the requested start is older than 60 days, and reject missing access rather than returning misleading historical totals. Existing pagination limits still fail closed. GA4 data availability remains subject to the property's actual collection history; querying an earlier start does not create historical tracking data. The earlier 30-complete-day default described above is superseded by this setting.
