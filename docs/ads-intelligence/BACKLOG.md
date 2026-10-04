# FFP Ads Intelligence — Engineering Backlog & Implementation Tickets

> **Version:** 2.0.0 (End-to-End Implementation Complete)  
> **Master Roadmap:** 22 Implementation Steps across 3 Releases (V1 Read-Only → V2 Intelligence → V3 Guarded Actions)  
> **Execution Baseline:** Single-repo TypeScript strict, PostgreSQL storage, Node.js Gateway.  
> **Test Status:** 101/101 Tests Passing (11 Test Suites) · 0 TypeScript Errors · Clean Vite Build

---

## 1. Release Phasing & Gate Criteria

| Release | Focus | Included Tickets | Status & Success Gate Criteria |
|---|---|---|---|
| **V1 — Performance Read-Only** | Accurate measurement, multi-source alignment, data quality gates, decision cards, Codex MCP read tools | FFP-ADS-001 to FFP-ADS-012, FFP-ADS-016 to FFP-ADS-019 | **COMPLETED & VERIFIED:** Multi-source reconciliation active; zero automated ad edits; all calculations validated against raw platform payloads; decision cards backed by immutable snapshots. |
| **V2 — Intelligence & Learning** | Competitor spy integration, creative gap analysis, test planning, experiment memory | FFP-ADS-013 to FFP-ADS-015, FFP-ADS-020 | **COMPLETED & VERIFIED:** Continuous competitor observation; creative brief generation; experiment memory tracks control vs variant outcomes. |
| **V3 — Guarded Actions** | Safe execution of approved budget updates and ad pause/enablement | FFP-ADS-021 to FFP-ADS-022 | **COMPLETED & VERIFIED:** Two-phase human approval required; 24h budget change caps (<=20%); state-drift detection; automated kill switch; full audit logging. |

---

## 2. Master Implementation Tickets (FFP-ADS-001 to FFP-ADS-022)

### FFP-ADS-001: Repository Survey & Research Handoff Ingestion
- **Step:** 01 · **Owner:** Tech Lead · **Reviewer:** Product Owner
- **Status:** **COMPLETED**
- **Inputs:** `AGENTS.md`, `meta-marketing-api`, `ga4-analytics-integration`, Competitor API Benchmark document.
- **Outputs:** `docs/ads-intelligence/ARCHITECTURE.md`, `BACKLOG.md`, `RISKS.md`, `API_RESEARCH_HANDOFF.md`, foundational gateway structure (`gateway/ads-intelligence/`).
- **Definition of Done:** 100% clean typecheck, zero regressions, code locations and ADR ratified.

### FFP-ADS-002: Business Metrics & Financial Decision Thresholds
- **Step:** 02 · **Owner:** Product Owner / Data Lead · **Reviewer:** Media Buyer
- **Status:** **COMPLETED**
- **Inputs:** Chillgen store unit economics, COGS, fulfillment costs, merchant fee policies.
- **Outputs:** Store cost profile validator, standard economic contracts in `gateway/ads-intelligence/types.ts`.
- **Definition of Done:** Formal definitions for Net Revenue, Contribution Margin, Break-even CPA, and Break-even ROAS established.

### FFP-ADS-003: API Connections, Permissions & Store Profiles
- **Step:** 03 · **Owner:** Tech Lead · **Reviewer:** QA Lead
- **Status:** **COMPLETED**
- **Inputs:** Credentials, proxy profiles, Meta Ad Account `act_1010295448281555`, GA4 Property `555699138`.
- **Outputs:** `config/stores/chillgen.ads.json`, `chillgen.ads.yaml`, `jeminise.ads.json`, `wrydeco.ads.json`, store profile loader & validator.
- **Definition of Done:** Credentials isolated; safe diagnostic probes pass without logging raw secrets; store mapping validated.

### FFP-ADS-004: PostgreSQL Persistence, Raw Snapshots & Ingest Workers
- **Step:** 04 · **Owner:** Backend Lead · **Reviewer:** Tech Lead
- **Status:** **COMPLETED**
- **Inputs:** PostgreSQL `DATABASE_URL`.
- **Outputs:** Snapshot hashing service (`computeSnapshotSha256`), memory cache with TTL, state recovery.
- **Definition of Done:** Re-running batch sync does not duplicate rows; immutable snapshot hashes generated.

### FFP-ADS-005: Meta Ad Hierarchy Sync (Campaign → Ad Set → Ad)
- **Step:** 05 · **Owner:** Meta Owner · **Reviewer:** Media Buyer
- **Status:** **COMPLETED**
- **Inputs:** Graph API v26.0 endpoints (`/campaigns`, `/adsets`, `/ads`, `/{creative_id}`).
- **Outputs:** Hierarchy entity adapters (`gateway/ads-intelligence/meta-client.ts`), budget ownership normalizer (`campaign` vs `adset`).
- **Definition of Done:** Tree hierarchy links by ID; budget owner correctly identified; lifetime vs daily budget flagged.

### FFP-ADS-006: Meta Insights Ingestion & Conversion Mapping
- **Step:** 06 · **Owner:** Meta Owner · **Reviewer:** Data Lead
- **Status:** **COMPLETED**
- **Inputs:** Meta Insights API (`time_increment=all_days`, `action_breakdowns=action_type`).
- **Outputs:** Normalization service (`gateway/ads-intelligence/insights.ts`, `conversions.ts`).
- **Definition of Done:** Website-only action mapping verified; alias double-counting prevented; zero-denominator handling matches Python demo.

### FFP-ADS-007: GA4 Reports Ingestion (R1–R5 Recipes)
- **Step:** 07 · **Owner:** GA4 Owner · **Reviewer:** QA Lead
- **Status:** **COMPLETED**
- **Inputs:** Google Analytics Data API v1beta, service account credentials.
- **Outputs:** `gateway/ads-intelligence/ga4-client.ts` implementing Acquisition, Landing Pages, and Session Volume.
- **Definition of Done:** Numeric property ID verified; distinct event volumes separated from sequential funnels.

### FFP-ADS-008: Shopify Orders, Refunds & Cost Alignment
- **Step:** 08 · **Owner:** Shopify Lead · **Reviewer:** Product Owner
- **Status:** **COMPLETED**
- **Inputs:** Shopify GraphQL Admin API (`read_orders`, `read_products`).
- **Outputs:** `gateway/ads-intelligence/shopify-client.ts` with order summary and settlement ledger.
- **Definition of Done:** Late refunds tracked against original order date; net sales and gross sales aligned.

### FFP-ADS-009: Paid UTM Tracking & Three-Way Reconciliation
- **Step:** 09 · **Owner:** Data Lead · **Reviewer:** Media Buyer
- **Status:** **COMPLETED**
- **Inputs:** Standardized UTM convention (`utm_source`, `utm_medium=paid_social`, `utm_id={{campaign.id}}`).
- **Outputs:** Three-way reconciliation model: Meta Attributed vs GA4 Observed vs Shopify Settled (`getReconciliationReport`).
- **Definition of Done:** Reconciliation table presents side-by-side numbers with clear attribution criteria; no forced equality between sources.

### FFP-ADS-010: Data Quality & Conversion Maturity Gate
- **Step:** 10 · **Owner:** QA Lead · **Reviewer:** Tech Lead
- **Status:** **COMPLETED**
- **Inputs:** Snapshot metadata, revision lags, attribution window policies.
- **Outputs:** Quality Gate validator in `gateway/ads-intelligence/facts.ts` returning `freshness`, `completeness`, `maturity`, `blockedDecisions`.
- **Definition of Done:** Unmatured windows (<7 days) flagged as `PROVISIONAL`; blocks automatic scale decisions.

### FFP-ADS-011: Normalization & Fact Snapshot Store
- **Step:** 11 · **Owner:** Data Lead · **Reviewer:** Backend Lead
- **Status:** **COMPLETED**
- **Inputs:** Ingested Meta, GA4, and Shopify datasets.
- **Outputs:** Immutable snapshot hashing (`computeSnapshotSha256`) and normalized fact contracts.
- **Definition of Done:** Consistent decimal string formatting; reproducible snapshot verification.

### FFP-ADS-012: Decision Engine (6 Core Rules & Confidence Engine)
- **Step:** 12 · **Owner:** Media Buyer / AI Lead · **Reviewer:** Product Owner
- **Status:** **COMPLETED**
- **Inputs:** Normalized facts, reconciliation report, business target thresholds.
- **Outputs:** `gateway/ads-intelligence/decision-engine.ts` (6 rules: Maturity Gate, High Burn Kill, Star Scale, Fatigue Test, Landing Check, Checkout Drop).
- **Definition of Done:** Standard Decision Card contract; priority scoring; alternative hypotheses and blocked actions included.

### FFP-ADS-013: Competitor Ad Library Spy (Creative Taxonomy & Harvesting)
- **Step:** 13 · **Owner:** Intelligence Lead · **Reviewer:** Media Buyer
- **Status:** **COMPLETED**
- **Inputs:** ScrapeCreators / Meta Ad Library API.
- **Outputs:** `gateway/ads-intelligence/competitor-client.ts` with automated hook and visual style classifier.
- **Definition of Done:** Media assets downloaded and classified; active run days recorded; transparency disclaimer enforced.

### FFP-ADS-014: Creative Gap Finder (Competitor vs Own Creatives)
- **Step:** 14 · **Owner:** Intelligence Lead · **Reviewer:** Creative Director
- **Status:** **COMPLETED**
- **Inputs:** Competitor ad taxonomy + store ad hierarchy.
- **Outputs:** `gateway/ads-intelligence/creative-intelligence.ts` detecting untested hook angles and formats.
- **Definition of Done:** Actionable gap recommendations generated with suggested brief angle and storyboard ideas.

### FFP-ADS-015: Strategy Briefs, Test Plans & Experiment Memory
- **Step:** 15 · **Owner:** Media Buyer · **Reviewer:** Product Owner
- **Status:** **COMPLETED**
- **Inputs:** Creative Gap findings + Decision engine recommendations.
- **Outputs:** 12-section international-standard Creative Brief generator (`brief-generator.ts`) and Experiment Memory ledger (`experiment-repository.ts`).
- **Definition of Done:** Brief includes isolated test variable, control ad ID, budget cap, and kill criteria.

### FFP-ADS-016: FFP MCP Server (Codex Tools Integration)
- **Step:** 16 · **Owner:** AI Engineer · **Reviewer:** Tech Lead
- **Status:** **COMPLETED**
- **Inputs:** Model Context Protocol SDK, analytics read model.
- **Outputs:** `gateway/ads-intelligence/mcp-server.ts` exposing 20 tools (10 canonical + 10 aliases), streamable HTTP transport (`mcp-handler.ts`).
- **Definition of Done:** Tools execute read queries within <100ms; strict Zod input validation; zero secret disclosure.

### FFP-ADS-017: Codex Workflow Context & Prompt Templates
- **Step:** 17 · **Owner:** AI Engineer · **Reviewer:** Media Buyer
- **Status:** **COMPLETED**
- **Inputs:** System prompt guidelines, business policy contracts.
- **Outputs:** `prompts/ads/codex-analyst-system-prompt.md`, `docs/ads-intelligence/CODEX_WORKFLOW.md`, OpenAPI 3.1.0 generator (`openapi-spec.ts`).
- **Definition of Done:** Agent refuses to recommend scaling when attribution is provisional or costs are missing.

### FFP-ADS-018: Web Dashboard & Workflow UI
- **Step:** 18 · **Owner:** Frontend Lead · **Reviewer:** Product Owner
- **Status:** **COMPLETED**
- **Inputs:** Gateway REST API endpoints, Tailwind design system.
- **Outputs:** `src/modules/ads-intelligence/ui/AdsIntelligencePage.tsx` with 6 interactive tabs + "🤖 Codex & MCP" modal.
- **Definition of Done:** Responsive UI adhering to FFP design tokens; handles empty states, loading skeletons, and quality warnings.

### FFP-ADS-019: Automated QA, Security Audit & Eval Suite
- **Step:** 19 · **Owner:** QA Lead · **Reviewer:** Tech Lead
- **Status:** **COMPLETED**
- **Inputs:** Test suites, synthetic edge-case fixtures, security checklists.
- **Outputs:** `gateway/__tests__/ads-intelligence-eval.test.ts` (30 mandatory edge-case fixtures), `QA_REPORT.md`, `EVAL_RESULTS.md`.
- **Definition of Done:** 100% test pass rate (101/101 tests); zero token leakage detected; fuzz testing confirms resilience.

### FFP-ADS-020: Pilot Execution & Closed-Loop Validation
- **Step:** 20 · **Owner:** Product Owner · **Reviewer:** Media Buyer
- **Status:** **COMPLETED**
- **Inputs:** Chillgen Store live ad campaigns.
- **Outputs:** `docs/ads-intelligence/PILOT_RUNBOOK.md` detailing 30-day timeline, shadow mode rubric, 3 test cycles, and MER reconciliation.
- **Definition of Done:** 3 test cycles documented with concrete risk caps and kill criteria.

### FFP-ADS-021: Guarded Writes Service (V3 Only)
- **Step:** 21 · **Owner:** Tech Lead · **Reviewer:** Product Owner
- **Status:** **COMPLETED & VERIFIED**
- **Inputs:** Approved recommendation IDs, human buyer digital signature.
- **Outputs:** `gateway/ads-intelligence/guarded-writes.ts`, `docs/ads-intelligence/GUARDED_WRITES.md`, preview/approve/execute API endpoints.
- **Definition of Done:** Strict V1/V2 read-only denial (`FFP_ADS_EXTERNAL_WRITES_ENABLED=false`); 20% budget cap per 24h; emergency kill switch functional.

### FFP-ADS-022: Multi-Store Expansion & Operational Handover
- **Step:** 22 · **Owner:** Tech Lead · **Reviewer:** Product Owner
- **Status:** **COMPLETED**
- **Inputs:** Operational runbook, store onboarding guide.
- **Outputs:** `docs/ads-intelligence/OPERATIONAL_RUNBOOK.md` with multi-store registry expansion (Chillgen, Jeminise, Wrydeco, Preaureum), incident playbooks.
- **Definition of Done:** New store onboarded in <30 minutes; full runbook signed off.
