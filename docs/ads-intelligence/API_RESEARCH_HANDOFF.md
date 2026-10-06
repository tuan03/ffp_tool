# FFP Ads Intelligence — API Research Handoff & Technical Synthesis

> **Version:** 1.0.0  
> **Status:** APPROVED & INGESTED  
> **Synthesis of:** 3 External Research Spikes (Competitor Spy API Benchmark, Meta Marketing API Demo, GA4 Analytics Integration)

---

## 1. Competitor Spy API Benchmark

### 1.1 Provenance & Test Scope
- **Source Document:** `BÁO CÁO TÓM TẮT – COMPETITOR ADS API.docx` (Tested on 03/10/2026 by Tuấn / Research Team).
- **Scope:** 3 real Facebook competitor Pages, active ads only, `country=ALL`, `media=ALL`, up to 70 unique ads per page ($210$ total ads per provider).
- **Evaluated Providers:** ScrapeCreators, SearchAPI, and Apify.

### 1.2 Benchmark Results Matrix

| Metric / Dimension | ScrapeCreators | SearchAPI | Apify |
|---|---|---|---|
| **Unique Ads Harvested** | 210 / 210 | 210 / 210 | 210 / 210 |
| **Core Fields (ID, Status, Date, Body)** | 210 / 210 | 210 / 210 | 210 / 210 |
| **Caption Extracted** | 201 / 210 | 201 / 210 | 201 / 210 |
| **Headline Extracted** | 123 / 210 | 123 / 210 | 123 / 210 |
| **CTA + Landing URL Extracted** | 210 / 210 | 210 / 210 | 210 / 210 |
| **Multi-Card Ads Detected** | 23 / 210 | 23 / 210 | 23 / 210 |
| **Media Asset Verification** | 30/30 OK; full 6/6 | 30/30 OK; full 6/6 | 30/30 OK; full 6/6 |
| **Average Execution Time / Page** | **28.962 s** | **13.945 s** | 91.075 s |
| **Requests for 3 Pages** | 35 requests | 15 requests | 30 requests |
| **HTTP / Network Failures** | 0 / 35 | 0 / 15 | 0 / 30 |
| **Estimated Cost for 3 Pages** | **$0.0658** | **$0.0600** | $1.2180 |
| **Projected Monthly Cost (100 Pages/mo)** | **~$65.80** | **~$100 (Plan)** | ~$1,218.00 |

### 1.3 Strategic Provider Selection
1. **Primary Pilot Provider — ScrapeCreators**: Direct REST integration, stable payload format, active balance of 4,999 credits, highly reliable media asset extraction.
2. **Primary Backup Provider — SearchAPI**: Fastest execution (13.9s avg), lowest request volume per page, ideal failover target if ScrapeCreators encounters outages.
3. **Secondary Backup — Apify**: Functional but higher latency (91s avg) due to actor container start/poll workflow, and 18x higher sample cost.

### 1.4 Known Limitations & Boundary Warnings
- Creative variations (e.g., dynamic creative rules) are only partially represented via card arrays.
- Ad Archive ID must be strictly isolated from Meta Graph API Ad ID namespace.
- No direct Facebook Ads Library UI manual reconciliation was performed; results reflect API payload fidelity on 210 sample ads.

---

## 2. Meta Marketing API Demo Handoff

### 2.1 Provenance & Environment
- **Source Codebase:** `C:\Users\trung\Downloads\meta-marketing-api` (Verified 03/10/2026).
- **Reference Document:** `BAO_CAO_BAN_GIAO.md`.
- **Target Ad Account:** `act_1010295448281555` (Chillgen Store, USD, timezone `America/Los_Angeles`).
- **Verified Graph API Version:** `v26.0`.
- **Verified Scope:** `ads_read` verified live via `doctor.py`. Mutation scope `ads_management` is intentionally not activated.

### 2.2 Core Ingestion & Normalization Principles
1. **Direct Period Hierarchy**:
   - `time_increment=all_days` queried independently at Campaign, AdSet, and Ad levels.
   - **Never roll up Reach** across days or across hierarchy levels.
   - **Never overwrite Campaign Spend** with the sum of child Ad rows. Flag discrepancies as quality warnings.
2. **Conversion Extraction & Anti-Duplication**:
   - Strict action type: `offsite_conversion.fb_pixel_purchase`.
   - Generic aliases (`omni_purchase`, `purchase`) are never added to pixel purchases.
   - If pixel purchases are zero or missing but `omni_purchase > 0`, mark state as `website_scope_unresolved` and warn the operator.
3. **Metric Calculations**:
   - $\text{CPA} = \text{Spend} / \text{Pixel Purchases}$ (requires $> 0$ purchases).
   - $\text{ROAS} = \text{Pixel Purchase Value} / \text{Spend}$ (requires $> 0$ spend).
   - Both derived ROAS and API-returned `website_purchase_roas` are preserved for cross-examination.
4. **Proxy Architecture**:
   - Outbound requests routed through designated proxy profiles (e.g. `proxy-profiles.json`), fail-closed without fallback to direct connection.

---

## 3. Google Analytics 4 (GA4) Analytics Integration

### 3.1 Provenance & Configuration
- **Source Codebase:** `D:\CODE\ga4-analytics-integration` (GA4 Data API v1beta).
- **Target Property ID:** `555699138` (Numeric property ID, not measurement ID `G-...`).
- **Authentication:** Service Account JSON (`credentials/chillgen-service-account.json`).
- **Google Cloud API:** `analyticsdata.googleapis.com` with scope `https://www.googleapis.com/auth/analytics.readonly`.

### 3.2 Standardized Report Recipes

| Recipe Code | Recipe Name | Primary Dimensions | Primary Metrics | Purpose |
|---|---|---|---|---|
| **GA4-R1** | Acquisition | `date`, `sessionSourceMedium`, `sessionCampaignName`, `sessionManualCampaignId`, `sessionManualAdContent` | `sessions`, `totalUsers`, `activeUsers` | Paid traffic acquisition & UTM validation |
| **GA4-R2** | Event Volume | `date`, `sessionSourceMedium`, `sessionManualCampaignId`, `sessionManualAdContent`, `eventName` | `eventCount` | Event tracking (`view_item`, `add_to_cart`, `begin_checkout`, `purchase`) |
| **GA4-R3** | Landing Pages | `date`, `landingPagePlusQueryString`, `sessionSourceMedium`, campaign dimensions | `sessions`, `engagedSessions`, `ecommercePurchases`, `purchaseRevenue` | Post-click landing page effectiveness |
| **GA4-R4** | Product Items | `date`, `itemId`, `itemName` | `itemsViewed`, `itemsAddedToCart`, `itemsCheckedOut`, `itemsPurchased`, `itemRevenue` | Catalog SKU engagement & revenue |
| **GA4-R5** | Reconciliation | `transactionId`, `sessionManualCampaignId`, `sessionManualAdContent` | `ecommercePurchases`, `purchaseRevenue` | Order reconciliation with Shopify transactions |

### 3.3 Critical Caveats & Quality Controls
- **Event Volume $\neq$ Sequential Funnel**: `GA4-R2` captures event counts, not user-level sequential cohort drop-offs. One user may generate multiple `add_to_cart` events.
- **Thresholding & Sampling**: Data API responses must be parsed for `subjectToThresholding` and `samplingMetadata`. Small conversion counts may be suppressed by Google signals thresholding.
- **Property Quotas**: Monitor hourly and daily token consumption using `returnPropertyQuota=true`.

---

## 4. Immediate Architectural Synthesis in FFP Tool

| Research Area | Integrated Component in FFP | Location |
|---|---|---|
| Meta Conversion & Insights Engine | TypeScript implementation of `website_metrics`, `normalize`, `dates_for_account` | `gateway/ads-intelligence/conversions.ts`<br>`gateway/ads-intelligence/insights.ts` |
| Store Ads Profile | Typed configuration loader with validation for Chillgen | `gateway/ads-intelligence/store-profile.ts`<br>`config/stores/chillgen.ads.json` |
| GA4 & Meta Fact Schema | Unified interfaces and normalized fact types | `gateway/ads-intelligence/types.ts` |
| Competitor Spy Provider | ScrapeCreators client with budget guard & SearchAPI fallback | Phase 4 (`FFP-ADS-013`) |
