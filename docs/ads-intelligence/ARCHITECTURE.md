# FFP Ads Intelligence — System Architecture Specification (ADR & Architecture Plan)

> **Document Version:** 1.0.0  
> **Release Target:** V1 (Performance Read-Only) → V2 (Intelligence & Learning) → V3 (Guarded Writes)  
> **Repository Path:** `gateway/ads-intelligence/` (Backend / Gateway) & `src/modules/ads-intelligence/` (Web UI)  
> **Database Convention:** PostgreSQL with schema isolation (`DATABASE_URL=postgresql://ffp_tool:...@127.0.0.1:5433/ffp_tool`)  
> **Primary Pilot Store:** `chillgen` (Ad Account: `act_1010295448281555`, GA4: `555699138`, Shopify: `chillgen.myshopify.com`)

---

## 1. Executive Summary & Core Architectural Tenets

FFP Ads Intelligence is designed to transform ad operations from disparate API dashboards into a closed-loop intelligence system:
$$\text{Measure Accurately} \longrightarrow \text{Benchmark Fairly} \longrightarrow \text{Diagnose Root Cause} \longrightarrow \text{Competitor Spy} \longrightarrow \text{Controlled Test Brief} \longrightarrow \text{Re-measure}$$

### Core Tenets
1. **Never conflate tracking sources**: Meta attributed revenue, GA4 observed conversions, and Shopify cashflow/orders represent distinct attribution windows, counting methods, and date bases. They are displayed side-by-side with provenance, never force-reconciled or summed.
2. **Never sum overlapping aliases or non-additive metrics**:
   - `offsite_conversion.fb_pixel_purchase` and `omni_purchase` are never summed.
   - Reach is never rolled up across days or entity hierarchies.
   - Currency minor units (e.g. Meta cents) are normalized into decimal strings; platform object IDs are strictly preserved as non-truncated strings.
3. **Immutability of evidence**: Any recommendation produced by AI or rule engines must reference an immutable raw snapshot digest (`snapshot_sha256`) and quality gate result. When platform reports re-attribute or revise historically, the historical decision record remains audit-verifiable.
4. **Strict isolation of write permissions**:
   - V1 & V2 are strictly Read-Only with internal FFP persistence (snapshots, facts, briefs, decision cards, experiment logs).
   - V3 mutations (pause/enable ad, budget updates) require two-phase human review, rate limits, spending caps, and circuit breakers. External write mutations are disabled by default (`FFP_ADS_EXTERNAL_WRITES_ENABLED=false`).
5. **No Token Leakage**: Graph API tokens, GA4 service account credentials, and proxy passwords must never enter LLM prompt contexts, tool outputs, or browser logs.

---

## 2. High-Level System Architecture Diagram

```text
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                                   EXTERNAL SOURCES                                     │
 │  Meta Marketing API         GA4 Data API        Shopify Admin API      Competitor APIs  │
 │  (v26.0 / Graph API)       (v1beta Data API)      (2026-07 GraphQL)   (ScrapeCreators/  │
 │  act_1010295448281555          555699138       chillgen.myshopify.com     SearchAPI)   │
 └──────────────┬───────────────────┬──────────────────────┬──────────────────────┬───────┘
                │                   │                      │                      │
                ▼                   ▼                      ▼                      ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                      FFP GATEWAY ADAPTERS (gateway/ads-intelligence/)                  │
 │   Meta Insights Adapter   GA4 Report Adapter   Shopify Order Adapter  Competitor Spy   │
 │   - Cursor pagination     - Quota control      - Order reconciliation - Asset download │
 │   - Decimal normalization - Recipe validation  - Cost profile join    - Watchlist rate │
 │   - Proxy routing         - Thresholding flags - PII redaction        - SHA-256 hash   │
 └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                                            ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                        STORAGE & INGESTION WORKER (PostgreSQL)                         │
 │                                                                                        │
 │   Immutable Snapshots                      Normalized Fact Tables                     │
 │   - raw_snapshots                          - meta_daily_facts / meta_window_facts      │
 │   - sync_runs & checkpoints                - ga4_report_facts                          │
 │   - api_usage & quotas                     - shopify_order_facts & cost_profiles       │
 │                                            - competitor_ad_observations                │
 └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                                            ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                       DATA QUALITY & CONVERSION MATURITY ENGINE                        │
 │   - Freshness & Completeness validation (detect missing days / broken cursors)         │
 │   - Maturity Gate: flag provisional (<7d attribution lag) vs finalized periods         │
 │   - Discrepancy checks: Link Clicks vs Clicks, Ad Spend vs Campaign Spend               │
 │   - Financial Guard: block profit scaling when SKU product costs are missing           │
 └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                                            ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                       ANALYTICS READ MODEL & EVIDENCE PACK GENERATOR                   │
 │   - Multi-source alignment (Meta vs GA4 vs Shopify)                                    │
 │   - Performance metrics: CPA, MER, ROAS, Net Contribution Margin                       │
 │   - Entity hierarchy: Campaign -> AdSet -> Ad with budget owner attribution            │
 │   - Creative & Competitive intelligence: angle, hook, CTA, active duration             │
 └───────────────────────────┬───────────────────────────────────────────────┬────────────┘
                             │                                               │
                             ▼                                               ▼
 ┌───────────────────────────────────────┐       ┌────────────────────────────────────────┐
 │        FFP MCP SERVER (Codex Tools)   │       │       FFP DASHBOARD (React / Vite)     │
 │   tools:                              │       │   pages:                               │
 │   - ads_get_store_overview            │       │   - Ads Performance (Meta/GA4/Shopify) │
 │   - ads_query_entity_insights         │       │   - Decision Queue & Alerts            │
 │   - ads_get_competitor_creative_gap   │       │   - Creative Intelligence & Spy Feed   │
 │   - ads_generate_test_brief           │       │   - Experiment Memory & Attribution    │
 └───────────────────┬───────────────────┘       └────────────────────────────────────────┘
                     │
                     ▼
 ┌───────────────────────────────────────┐
 │             CODEX ANALYST             │
 │   - Root cause hypothesis generator   │
 │   - Creative gap & angle synthesis    │
 │   - Test brief generation             │
 └───────────────────┬───────────────────┘
                     │
                     ▼
 ┌───────────────────────────────────────┐
 │       HUMAN MEDIA BUYER REVIEW        │
 │   [ APPROVE / REVISE / REJECT ]       │
 └───────────────────┬───────────────────┘
                     │ (Manual in V1/V2; Audited Write in V3)
                     ▼
 ┌───────────────────────────────────────┐
 │    EXPERIMENT MEMORY & RE-MEASURE     │
 └───────────────────────────────────────┘
```

---

## 3. Component Boundaries & Code Layout

In adherence to [AGENTS.md](file:///D:/CODE/Code_Clone/ffp_tool/AGENTS.md):
- All backend normalization, external adapters, DB repositories, and MCP tooling reside in `gateway/ads-intelligence/`.
- UI pages and components will reside in `src/modules/ads-intelligence/` (with route registration in `src/app/routes.tsx`).
- No module-level `package.json` or sub-workspaces.

```text
D:\CODE\Code_Clone\ffp_tool\
├── docs/ads-intelligence/
│   ├── README.md                      # Comprehensive specification & roadmap
│   ├── ARCHITECTURE.md                # System architecture, schemas & ADR (this document)
│   ├── BACKLOG.md                     # Phased ticket breakdown (FFP-ADS-001 to FFP-ADS-022)
│   ├── RISKS.md                       # Risk registry, circuit breakers & mitigations
│   └── API_RESEARCH_HANDOFF.md        # Synthesis of Meta, GA4, and Competitor research
├── config/stores/
│   ├── chillgen.ads.json              # Active Chillgen Store Ads Profile (JSON)
│   ├── chillgen.ads.example.json      # Sanitized example configuration template (JSON)
│   ├── chillgen.ads.yaml              # Active Chillgen Store Ads Profile (YAML)
│   └── chillgen.ads.example.yaml      # Sanitized example configuration template (YAML)
├── gateway/
│   └── ads-intelligence/
│       ├── types.ts                   # Core interfaces (Meta, GA4, Normalized Fact, Config)
│       ├── conversions.ts             # Strict conversion calculation & action mapping
│       ├── insights.ts                # Date calculation, normalization & anomaly detection
│       ├── facts.ts                   # Fact construction, maturity gating & canonical snapshot hashing
│       ├── store-profile.ts           # Store config loader, validator, and secrets resolver
│       └── index.ts                   # Public gateway exports
└── gateway/__tests__/
    ├── ads-intelligence-conversions.test.ts
    ├── ads-intelligence-insights.test.ts
    ├── ads-intelligence-facts.test.ts
    └── ads-intelligence-store-profile.test.ts
```

---

## 4. Database Schema Strategy (PostgreSQL)

FFP Tool configures PostgreSQL via `DATABASE_URL` (`postgresql://ffp_tool:ffp-local-pod-test-only@127.0.0.1:5433/ffp_tool`).
All Ads Intelligence tables reside in PostgreSQL with the `ads_` table prefix (or dedicated `ads_intelligence` schema) to ensure complete isolation from `auto_seo` tables.

### 4.1 Schema Tables & Partitioning

1. **`ads_stores` & `ads_source_connections`**
   - Store metadata, source connection status, token validity timestamps, and safe diagnostics.
2. **`ads_raw_snapshots`**
   - `id SERIAL PRIMARY KEY`, `store_id TEXT NOT NULL`, `source TEXT NOT NULL`, `query_signature TEXT NOT NULL`, `snapshot_sha256 TEXT NOT NULL`, `raw_payload JSONB NOT NULL`, `fetched_at TIMESTAMPTZ NOT NULL`.
3. **`ads_meta_daily_facts` & `ads_meta_window_facts`**
   - Fact grain: `(store_id, account_id, entity_level, entity_id, date_start, date_stop, attribution_setting)`.
   - Metrics: `spend`, `impressions`, `reach`, `frequency`, `cpm`, `ctr`, `inline_link_click_ctr`, `cpc`, `clicks`, `inline_link_clicks`.
   - Conversions: `landing_page_views`, `add_to_cart`, `checkout`, `purchase`, `purchase_value`, `cpa`, `roas`, `website_roas_api`, `conversion_states JSONB`.
4. **`ads_ga4_report_facts`**
   - Recipe ID (`acquisition`, `event_volume`, `landing_page`, `product`, `reconciliation`).
   - Dimensions & Metrics: `sessions`, `total_users`, `engaged_sessions`, `ecommerce_purchases`, `purchase_revenue`, `quota_consumed`.
5. **`ads_competitor_ads` & `ads_competitor_observations`**
   - Competitor page archive, first seen date, last seen date, caption, headline, CTA, landing URL, media hashes, observation duration (days active).
6. **`ads_experiments` & `ads_experiment_events`**
   - Experiment hypothesis, control vs test variant, target metric, evaluation dates, outcome verdict (`WIN`, `LOSS`, `INCONCLUSIVE`).

---

## 5. Normalized Metric Calculations & Math Rules

### 5.1 Action Mapping & Anti-Duplication
To prevent false ROAS inflation, Meta action arrays must parse strictly:
```text
landing_page_views -> "landing_page_view"
add_to_cart        -> "offsite_conversion.fb_pixel_add_to_cart"
checkout           -> "offsite_conversion.fb_pixel_initiate_checkout"
purchase           -> "offsite_conversion.fb_pixel_purchase"
```
- If `offsite_conversion.fb_pixel_purchase` is absent but `omni_purchase` or `purchase` is positive, mark state as `website_scope_unresolved`. **Never fall back to omni_purchase automatically.**
- If duplicate `action_type` keys appear in a single response, abort with error; do not aggregate.

### 5.2 Zero Denominators & Ratio Safety
- Reach $= 0 \implies \text{Frequency} = \text{null}$
- Impressions $= 0 \implies \text{CPM} = \text{null}, \text{CTR} = \text{null}, \text{Link CTR} = \text{null}$
- Clicks $= 0 \implies \text{CPC} = \text{null}$
- Purchases $= 0 \implies \text{CPA} = \text{null} \text{ (state: zero\_purchases)}$
- Spend $= 0 \implies \text{ROAS} = \text{null} \text{ (state: zero\_spend)}$

### 5.3 Contribution Economics
$$\text{Net Merchandise Revenue} = \text{Gross Merchandise Sales} - \text{Discounts} - \text{Refunds}$$
$$\text{Contribution Before Ads} = \text{Net Revenue} - \text{COGS} - \text{Shipping Cost} - \text{Payment Gateway Fees}$$
$$\text{Contribution After Ads} = \text{Contribution Before Ads} - \text{Ad Spend}$$
$$\text{Break-Even CPA} = \frac{\text{Contribution Before Ads}}{\text{Eligible Orders}}$$
$$\text{Break-Even ROAS} = \frac{1}{\text{Contribution Margin Before Ads}}$$

---

## 6. MCP Analyst Interface Boundary

The FFP MCP Server provides scoped query tools to Codex:
- `ads_get_store_overview`: Aggregated performance for a store within a given date window.
- `ads_query_entity_insights`: Granular Campaign/AdSet/Ad breakdown with data quality annotations.
- `ads_get_competitor_creative_gap`: Top active competitor angles, format breakdown, and longest-running ads.
- `ads_submit_recommendation`: Formulates structured advice with linked evidence IDs for human review.

**Enforced Constraints**:
- Codex is given evidence IDs, not raw database handles or admin tokens.
- Codex cannot execute arbitrary SQL queries or external Graph API writes.
- Prompts must instruct the analyst to report data maturity limits and alternative hypotheses.
