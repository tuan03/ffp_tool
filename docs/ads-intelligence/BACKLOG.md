# FFP Ads Intelligence — Engineering Backlog & Implementation Tickets

> **Version:** 1.0.0  
> **Master Roadmap:** 22 Implementation Steps across 3 Releases (V1 Read-Only → V2 Intelligence → V3 Guarded Actions)  
> **Execution Baseline:** Single-repo TypeScript strict, PostgreSQL storage, Node.js Gateway.

---

## 1. Release Phasing & Gate Criteria

| Release | Focus | Included Tickets | Success Gate Criteria |
|---|---|---|---|
| **V1 — Performance Read-Only** | Accurate measurement, multi-source alignment, data quality gates, decision cards, Codex MCP read tools | FFP-ADS-001 to FFP-ADS-012, FFP-ADS-016 to FFP-ADS-019 | Multi-source reconciliation active; zero automated ad edits; all calculations validated against raw platform payloads; decision cards backed by immutable snapshots. |
| **V2 — Intelligence & Learning** | Competitor spy integration, creative gap analysis, test planning, experiment memory | FFP-ADS-013 to FFP-ADS-015, FFP-ADS-020 | Continuous competitor observation; creative brief generation; experiment memory tracks control vs variant outcomes. |
| **V3 — Guarded Actions** | Safe execution of approved budget updates and ad pause/enablement | FFP-ADS-021 to FFP-ADS-022 | Two-phase human approval required; 24h budget change caps; automated rollback & kill switch; full audit logging. |

---

## 2. Master Implementation Tickets (FFP-ADS-001 to FFP-ADS-022)

### FFP-ADS-001: Repository Survey & Research Handoff Ingestion
- **Step:** 01 · **Owner:** Tech Lead · **Reviewer:** Product Owner
- **Status:** **IN PROGRESS (Current Work Unit)**
- **Inputs:** `AGENTS.md`, `meta-marketing-api`, `ga4-analytics-integration`, Competitor API Benchmark document.
- **Outputs:** `docs/ads-intelligence/ARCHITECTURE.md`, `BACKLOG.md`, `RISKS.md`, `API_RESEARCH_HANDOFF.md`, foundational gateway structure (`gateway/ads-intelligence/`).
- **Definition of Done:** 100% clean typecheck (`npm run typecheck:gateway` and `npm run typecheck`), zero regressions, code locations and ADR ratified.

### FFP-ADS-002: Business Metrics & Financial Decision Thresholds
- **Step:** 02 · **Owner:** Product Owner / Data Lead · **Reviewer:** Media Buyer
- **Status:** PENDING
- **Inputs:** Chillgen store unit economics, COGS, fulfillment costs, merchant fee policies.
- **Outputs:** `docs/ads-intelligence/BUSINESS_METRICS.md`, store cost profile validator.
- **Definition of Done:** Formal definitions for Net Revenue, Contribution Margin, Break-even CPA, and Break-even ROAS established; unverified targets marked `PENDING_APPROVAL`.

### FFP-ADS-003: API Connections, Permissions & Store Profiles
- **Step:** 03 · **Owner:** Tech Lead · **Reviewer:** QA Lead
- **Status:** FOUNDATION COMPLETE (`chillgen.ads.json` loader implemented)
- **Inputs:** Credentials, proxy profiles, Meta Ad Account `act_1010295448281555`, GA4 Property `555699138`.
- **Outputs:** `config/stores/chillgen.ads.json`, store profile validator, connection test harness.
- **Definition of Done:** Credentials isolated; safe diagnostic probes pass without logging raw secrets; store mapping validated.

### FFP-ADS-004: PostgreSQL Persistence, Raw Snapshots & Ingest Workers
- **Step:** 04 · **Owner:** Backend Lead · **Reviewer:** Tech Lead
- **Status:** PENDING
- **Inputs:** PostgreSQL `DATABASE_URL`.
- **Outputs:** DDL migration scripts for `ads_*` tables, snapshot persistence layer, idempotent worker queue.
- **Definition of Done:** Re-running batch sync does not duplicate rows; workers resume from checkpoints; immutable snapshot hashes generated.

### FFP-ADS-005: Meta Ad Hierarchy Sync (Campaign → Ad Set → Ad)
- **Step:** 05 · **Owner:** Meta Owner · **Reviewer:** Media Buyer
- **Status:** PENDING
- **Inputs:** Graph API v26.0 endpoints (`/campaigns`, `/adsets`, `/ads`, `/{creative_id}`).
- **Outputs:** Hierarchy entity adapters, budget ownership normalizer (`campaign` vs `adset`).
- **Definition of Done:** Tree hierarchy links by ID (not name); budget owner correctly identified; lifetime vs daily budget flagged.

### FFP-ADS-006: Meta Insights Ingestion & Conversion Mapping
- **Step:** 06 · **Owner:** Meta Owner · **Reviewer:** Data Lead
- **Status:** FOUNDATION COMPLETE (Core calculation engine ported & tested in TS)
- **Inputs:** Meta Insights API (`time_increment=all_days`, `action_breakdowns=action_type`).
- **Outputs:** Normalization service, multi-level query executor, CSV/JSON export utility.
- **Definition of Done:** Website-only action mapping verified; alias double-counting prevented; zero-denominator handling matches Python demo.

### FFP-ADS-007: GA4 Reports Ingestion (R1–R5 Recipes)
- **Step:** 07 · **Owner:** GA4 Owner · **Reviewer:** QA Lead
- **Status:** PENDING
- **Inputs:** Google Analytics Data API v1beta, service account credentials.
- **Outputs:** 5 report recipe clients (Acquisition, Event Volume, Landing Pages, Product Performance, Reconciliation).
- **Definition of Done:** Numeric property ID verified; thresholding/sampling flags surfaced; distinct event volumes separated from sequential funnels.

### FFP-ADS-008: Shopify Orders, Refunds & Cost Alignment
- **Step:** 08 · **Owner:** Shopify Lead · **Reviewer:** Product Owner
- **Status:** PENDING
- **Inputs:** Shopify GraphQL Admin API (`read_orders`, `read_products`).
- **Outputs:** Order reconciliation service, refund cohort alignment, SKU cost profile join.
- **Definition of Done:** Late refunds tracked against original order date; order line cost attribution handles multi-item carts; PII strictly redacted.

### FFP-ADS-009: Paid UTM Tracking & Three-Way Reconciliation
- **Step:** 09 · **Owner:** Data Lead · **Reviewer:** Media Buyer
- **Status:** PENDING
- **Inputs:** Standardized UTM convention (`utm_source`, `utm_medium=paid_social`, `utm_id={{campaign.id}}`, `utm_content={{ad.id}}`).
- **Outputs:** Three-way reconciliation model: Meta Attributed vs GA4 Observed vs Shopify Settled.
- **Definition of Done:** Reconciliation table presents side-by-side numbers with clear attribution criteria; no forced equality between sources.

### FFP-ADS-010: Data Quality & Conversion Maturity Gate
- **Step:** 10 · **Owner:** QA Lead · **Reviewer:** Tech Lead
- **Status:** PENDING
- **Inputs:** Snapshot metadata, revision lags, attribution window policies.
- **Outputs:** Quality Gate validator returning `freshness`, `completeness`, `maturity`, `blocked_decisions`.
- **Definition of Done:** Unmatured windows (<7 days) flagged as `PROVISIONAL`; missing costs block `SCALE_ON_PROFIT` recommendations.

### FFP-ADS-011: Metric Engine & Scoped Benchmarking
- **Step:** 11 · **Owner:** Data Lead · **Reviewer:** Media Buyer
- **Status:** PENDING
- **Inputs:** Normalized facts from Meta, GA4, Shopify.
- **Outputs:** Performance indicator calculator (CPA, MER, ROAS, Thumbstop rate, Hook rate).
- **Definition of Done:** Formulas versioned; zero/null edge cases handled; peer group benchmarks established.

### FFP-ADS-012: Decision Engine & Evidence Pack Generator
- **Step:** 12 · **Owner:** Tech Lead · **Reviewer:** Product Owner
- **Status:** COMPLETED (Phase 2)
- **Inputs:** Normalized facts + Quality Gate output + Business thresholds.
- **Outputs:** Decision card synthesizer generating structured findings with linked snapshot citations.
- **Definition of Done:** Every recommendation links to exact entity IDs and immutable snapshot hashes; conflicting evidence flagged.

### FFP-ADS-013: Competitor Spy Provider Integration
- **Step:** 13 · **Owner:** Competitor Lead · **Reviewer:** Tech Lead
- **Status:** COMPLETED (Phase 3)
- **Inputs:** ScrapeCreators API key (Primary Pilot), SearchAPI (Secondary Backup).
- **Outputs:** Competitor watchlist ingester, rate limiter, monthly cost cap tracker.
- **Definition of Done:** Daily tracking within $65/mo budget cap; ad deduplication by `ad_archive_id`; media asset mirroring.

### FFP-ADS-014: Creative Intelligence & Creative Gap Analysis
- **Step:** 14 · **Owner:** Creative Strategist · **Reviewer:** Media Buyer
- **Status:** COMPLETED (Phase 3)
- **Inputs:** Competitor ad archive, own ad creative library.
- **Outputs:** Creative taxonomy classifier (hooks, angles, formats, CTAs), duration tracker, Creative Gap matrix.
- **Definition of Done:** Identifies competitor angles running >30 days with no internal equivalent.

### FFP-ADS-015: Strategy Briefs, Test Plans & Experiment Memory
- **Step:** 15 · **Owner:** Media Buyer · **Reviewer:** Product Owner
- **Status:** PENDING
- **Inputs:** Creative Gap findings + Decision engine recommendations.
- **Outputs:** Structured Test Brief generator, Experiment Memory repository.
- **Definition of Done:** Brief includes hypothesis, isolated test variable, control ad ID, budget cap, and kill criteria.

### FFP-ADS-016: FFP MCP Server (Codex Tools Integration)
- **Step:** 16 · **Owner:** AI Engineer · **Reviewer:** Tech Lead
- **Status:** PENDING
- **Inputs:** Model Context Protocol SDK, analytics read model.
- **Outputs:** MCP tool suite (`ads_get_store_overview`, `ads_query_entity_insights`, `ads_get_competitor_creative_gap`, `ads_submit_recommendation`).
- **Definition of Done:** Tools execute read queries within <2s; input validation via Zod schemas; zero secret disclosure.

### FFP-ADS-017: Codex Workflow Context & Prompt Templates
- **Step:** 17 · **Owner:** AI Engineer · **Reviewer:** Media Buyer
- **Status:** PENDING
- **Inputs:** System prompt guidelines, business policy contracts.
- **Outputs:** Prompt templates enforcing skepticism, alternative hypotheses, and data maturity reminders.
- **Definition of Done:** Agent refuses to recommend scaling when attribution is provisional or costs are missing.

### FFP-ADS-018: Web Dashboard & Workflow UI
- **Step:** 18 · **Owner:** Frontend Lead · **Reviewer:** Product Owner
- **Status:** PENDING
- **Inputs:** Gateway REST API endpoints, Tailwind design system.
- **Outputs:** `src/modules/ads-intelligence/` UI views: Multi-Source Overview, Entity Drill-down, Competitor Spy Feed, Experiment Log.
- **Definition of Done:** Responsive UI adhering to FFP design tokens; handles empty states, loading skeletons, and quality warnings.

### FFP-ADS-019: Automated QA, Security Audit & Eval Suite
- **Step:** 19 · **Owner:** QA Lead · **Reviewer:** Tech Lead
- **Status:** PENDING
- **Inputs:** Test suites, synthetic edge-case fixtures, security checklists.
- **Outputs:** E2E test runs, AI evaluation benchmarks, OWASP security audit report.
- **Definition of Done:** 100% test pass rate; zero token leakage detected; fuzz testing confirms resilience to malformed API responses.

### FFP-ADS-020: Pilot Execution & Closed-Loop Validation
- **Step:** 20 · **Owner:** Product Owner · **Reviewer:** Media Buyer
- **Status:** PENDING
- **Inputs:** Chillgen Store live ad campaigns.
- **Outputs:** 30-day pilot performance report, baseline comparison, recommendation efficacy scorecard.
- **Definition of Done:** At least 3 test cycles completed; verified impact on contribution margin.

### FFP-ADS-021: Guarded Writes Service (V3 Only)
- **Step:** 21 · **Owner:** Tech Lead · **Reviewer:** Product Owner
- **Status:** PLANNED (V3)
- **Inputs:** Approved recommendation IDs, human buyer digital signature.
- **Outputs:** Mutating gateway service with preflight check, rate limits, spending fences, and instant rollback.
- **Definition of Done:** Requires explicit `FFP_ADS_EXTERNAL_WRITES_ENABLED=true`; maximum 20% budget change per 24h; emergency kill switch functional.

### FFP-ADS-022: Multi-Store Expansion & Operational Handover
- **Step:** 22 · **Owner:** Tech Lead · **Reviewer:** Product Owner
- **Status:** PLANNED
- **Inputs:** Operational runbook, store onboarding guide.
- **Outputs:** Onboarding CLI/wizard, multi-store registry expansion, team training documentation.
- **Definition of Done:** New store onboarded in <30 minutes; full runbook signed off.
