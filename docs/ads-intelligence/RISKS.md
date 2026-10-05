# FFP Ads Intelligence — Risk Registry & Circuit Breakers

> **Version:** 1.0.0  
> **Scope:** Technical, Attribution, Financial, AI & Operational Risks across V1, V2, and V3.

---

## 1. Risk Matrix Overview

| ID | Risk Category | Severity | Probability | Primary Circuit Breaker / Mitigation |
|---|---|---|---|---|
| **RSK-01** | Attribution Alias Double-Counting | **FATAL** | HIGH | Hardcode single verified action (`offsite_conversion.fb_pixel_purchase`); reject responses with duplicate keys; flag `website_scope_unresolved`. |
| **RSK-02** | Premature Scaling on Provisional Data | **HIGH** | HIGH | Conversion Maturity Gate: block scale advice for date windows < 7 days old; mark status as `PROVISIONAL`. |
| **RSK-03** | Rollup of Non-Additive Metrics (Reach/CTR) | **HIGH** | MEDIUM | Require direct period query from Graph API (`time_increment=all_days`); throw error if code attempts `SUM(reach)`. |
| **RSK-04** | Decimal Precision Loss & Currency Mismatch | **HIGH** | MEDIUM | Store all monetary values as Decimal strings; validate account currency matches reporting currency before joining facts. |
| **RSK-05** | API Rate Limits & Quota Exhaustion | **MEDIUM** | HIGH | Ingestion backoff with jitter; GA4 Property Quota tracking; monthly hard cost cap ($65) on competitor scraping. |
| **RSK-06** | Accidental Write Mutations in V1/V2 | **FATAL** | LOW | Read-Only enforcement: mutate endpoints disabled at gateway layer; reject requests unless `FFP_ADS_EXTERNAL_WRITES_ENABLED=true`. |
| **RSK-07** | PII Leakage to AI Context or Logs | **HIGH** | LOW | PII scrubber on Shopify order ingest: strip customer name, email, phone, and shipping address before DB storage or MCP serialization. |
| **RSK-08** | Secret / Token Leakage in Error Logs | **FATAL** | LOW | Global token redactor in HTTP client and logger; secrets loaded strictly from environment or secure local storage. |
| **RSK-09** | Broken Pagination & Partial Data Ingestion | **MEDIUM** | MEDIUM | Cursor replay detection; track `pages_fetched` and `expected_count`; mark incomplete sync runs as `PARTIAL`. |
| **RSK-10** | Missing SKU Costs Leading to False Profit | **HIGH** | MEDIUM | Block `SCALE_ON_PROFIT` recommendations if COGS or fulfillment cost coverage is below 90% for the store. |

---

## 2. In-Depth Risk Analysis & Mitigation Specifications

### RSK-01: Attribution Alias Double-Counting (Meta Actions)
- **Problem Scenario:** Meta Graph API returns multiple action entries representing the same conversion event (e.g. `offsite_conversion.fb_pixel_purchase`, `purchase`, `omni_purchase`). If an adapter naive-sums all `purchase` items, conversions and revenue are inflated by 2x or 3x, causing disastrous false-positive scaling recommendations.
- **Enforced Rule:**
  1. Map only the explicitly verified pixel action: `offsite_conversion.fb_pixel_purchase`.
  2. If the verified action is absent but alias keys (`omni_purchase`) have values $> 0$, set value to `null` and set state to `website_scope_unresolved`.
  3. If duplicate `action_type` keys exist in a single array, throw an explicit `DemoError / AdsIntelligenceError`.

### RSK-02: Premature Scaling on Provisional Data (Attribution Delay)
- **Problem Scenario:** Meta conversion reporting has an inherent latency (7-day click attribution window, SKAdNetwork modeling delays, CAPI processing). Campaigns analyzed on days $t-0$ to $t-2$ often look unprofitable (high CPA, low ROAS) simply because purchases have not yet been attributed back to the ad impression.
- **Enforced Rule:**
  1. Any window ending within the last 7 days is stamped `maturity: PROVISIONAL`.
  2. Decision Engine circuit breaker: Do NOT issue `SCALE` or `KILL` recommendations on provisional data. Mark action as `WAIT/INSUFFICIENT_EVIDENCE`.

### RSK-03: Reach & Non-Additive Rollup Errors
- **Problem Scenario:** Reach represents deduplicated unique individuals. If an analyst or query sums daily reach across 7 days ($1000 + 1000 + \dots = 7000$), the resulting metric is mathematically invalid (actual reach might only be $2000$).
- **Enforced Rule:**
  1. Weekly/monthly reach must be fetched directly from Graph API with `time_increment=all_days`.
  2. Gateway fact tables strictly prohibit aggregating reach across time or across entity levels.

### RSK-04: Multi-Currency & Budget Minor Units Confusion
- **Problem Scenario:** Graph API returns budgets in cents (e.g., `500` for `$5.00`), while Insights returns spend in standard currency units (`5.00`). If currency conversion or division by 100 is misapplied, spend calculations will be off by a factor of 100.
- **Enforced Rule:**
  1. Normalize all currency values to standard major units represented as fixed Decimal strings.
  2. Store the ISO currency code on every single fact record.
  3. Prohibit comparisons between campaigns operating in differing account currencies without explicit historical exchange rate conversion.

### RSK-05: Inadvertent API Mutations (Safety Gate)
- **Problem Scenario:** A buggy script or AI agent calls Graph API `POST /act_xxx/campaigns` or `/ads` and accidentally updates bids, pauses winning campaigns, or inflates ad budgets.
- **Enforced Rule:**
  1. Gateway enforces `FFP_ADS_EXTERNAL_WRITES_ENABLED=false` by default.
  2. No write adapter code is exposed to Codex MCP tools in V1/V2.
  3. V3 requires an explicit human token signature, max 20% budget deviation limit, and 24h cooldown timer.

### RSK-06: PII Stripping on Shopify Commerce Ingest
- **Problem Scenario:** Syncing customer order details into database tables accessible by MCP tools could expose PII (Customer Name, Email, Shipping Address) to LLM providers.
- **Enforced Rule:**
  1. Ingestion mapper extracts strictly: `order_id`, `created_at`, `line_items (sku, quantity, net_sales, cost)`, `discount_code`, `utm_parameters`.
  2. PII fields (`customer`, `email`, `phone`, `shipping_address`, `billing_address`) are discarded before persistence.
