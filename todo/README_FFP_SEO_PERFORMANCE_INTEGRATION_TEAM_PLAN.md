# FFP SEO Performance Data Integration — Team Agents Implementation Plan

**Document status:** Implementation source of truth for the Performance Data Integration workstream

**Document version:** 1.0

**Created:** 05/10/2026

**Parent specification:** `todo/README_FFP_SEO_BENCHMARK.md`

**Repository:** FFP Tool

**Recommended pilot:** `jeminise`; the exact public domain, GSC property and GA4 property must be confirmed by the owner

**Audited local base:** `0b9223f` with SEO versioning through `594c220`

**Integration prerequisite:** reconcile this local base with the latest `origin/main` before feature work; do not drop either the SEO versioning commits or newer mainline changes

> This document is a plan, not evidence that Google integrations or benchmark results are complete. The workstream is complete only after deterministic tests, PostgreSQL 17 tests, read-only real-data reconciliation and Chrome acceptance all pass with fresh evidence. This plan authorizes no production credential activation, Shopify write, approval or publish.

---

## 1. Executive answer and scope

The parent specification can be grouped into three major workstreams:

1. SEO versioning and the protected Shopify lifecycle.
2. Google performance data integration, benchmark evaluation and recommendation feedback.
3. Dashboard UI.

This document covers **workstream 2**. It depends on the version ledger from workstream 1 and publishes stable read contracts for workstream 3. It does not implement the final dashboard redesign.

The covered parent-specification steps are:

- Step 3: Google OAuth and per-store GSC/GA4 mapping.
- Step 4: integration, analytics, inspection, benchmark, recommendation and sync data.
- Step 7: GSC Search Analytics.
- Step 8: URL Inspection.
- Step 9: GA4 Data API.
- Step 10: calendar and version-aware Before/After benchmarks.
- Step 11: status and recommendation rules.
- Step 13: controlled feedback to Auto-SEO.
- Step 14: scheduling, pagination, cache, quota, freshness and failures.
- Sections 19–23: internal APIs, acceptance, real-data demo, runbook and handoff.

The delivery sequence is:

```text
Existing immutable SEO versions and URL history
    ↓
Google connections + per-store source mappings
    ↓
GSC / GA4 / URL Inspection normalized facts
    ↓
source-specific freshness and quality gates
    ↓
calendar or version-aligned benchmark runs
    ↓
deterministic status and recommendation records
    ↓
operator chooses Send to Auto-SEO
    ↓
new draft job only; human review and publish remain separate
```

### 1.1. Non-negotiable SEO Content boundary

The refactored SEO Content semantic input contract remains exactly:

1. Images — source of truth for the product.
2. Niche — disambiguates the product visible in the images.
3. Store profile — store-specific configuration.

Performance evidence is control-plane data for selection, diagnosis, operator review and audit. It may be linked to a revision by `recommendation_id` and stored outside the SEO Content input, but it must not become a fourth semantic input, restore legacy title/description/variant/keyword inputs, or bypass B1–B6 validation.

The parent document's illustrative Auto-SEO payload is therefore adapted at the current boundary:

- the recommendation record owns benchmark evidence, statuses, reasons and quality flags;
- the orchestrator re-reads the current product and builds the existing three-part SEO Content input;
- the queued job carries only a reference such as `performanceRecommendationId` as workflow metadata;
- approval and Shopify synchronization remain unchanged and human-controlled.

Any proposal to inject GSC/GA4 text directly into `SeoContentInput` is a separate breaking contract decision and must stop for owner approval.

This is one deliberate compatibility deviation from the parent document's Step 13 payload. The later owner-approved Input Contract V2 is more restrictive than that illustrative payload. The implementation still persists and exposes the complete performance context for diagnosis, audit and human review, but the default handoff uses it to decide **whether** a revision is warranted, not as additional product truth for **what** SEO content to write. If the owner later wants a data-informed writing sidecar for Codex MCP, its trust boundary and relationship to image source-of-truth require a separate approved contract; this plan must not smuggle it into the existing input.

---

## 2. Completion definition

This workstream is complete only when every condition below is true.

### 2.1. Google connections and store mappings

- OAuth is completed server-side with single-use state, authenticated-session binding, offline access and encrypted refresh-token storage.
- The requested scopes are read-only GSC and GA4 scopes.
- A callback without a new refresh token preserves the existing valid refresh token.
- Connections are first-class records, not the current singleton `sp_connection(id=1)` assumption.
- A store may reuse one Google connection for GSC and GA4 or reference two different connections.
- Every store mapping records exact GSC property, GA4 numeric property ID, verified storefront origin, optional stream identifier, hostname scope, timezone, currency and `mapping_revision`.
- Mapping status is source-specific: `CONNECTED`, `MISSING_PERMISSION`, `RECONNECT_REQUIRED`, `DISCONNECTED` or `NOT_CONFIGURED`.
- Changing a property creates a new mapping revision and controlled backfill; historical facts are never silently rebound.
- Disconnect stops new jobs for that connection without deleting historical facts.
- GSC mapping preserves the raw property identifier, URL-encodes it exactly once at the provider boundary, verifies an in-scope product URL plus a finalized seven-day read, and never sums overlapping domain and URL-prefix properties.

### 2.2. GSC Search Analytics

- G01–G05 contracts from the parent specification are implemented independently: property totals, page totals, observed page queries, country/device slices and comparison ranges.
- Metrics retain `clicks`, `impressions`, CTR as a 0–1 ratio and impression-weighted average position.
- Property totals never come from Top Queries or summed product rows.
- Pagination uses `rowLimit=25000` and `startRow`; each bounded partition is staged, deduplicated and atomically replaced only after every page succeeds.
- `fetch_complete` is distinct from provider coverage; hidden/anonymized/top-row limitations are retained.
- Finalized days, Pacific source timezone, watermark, query signature, filter signature, aggregation and coverage are durable.
- Country/device filters and datasets are durable when used by historical benchmarks, not only temporary report-cache rows.
- GSC alpha-3 countries and GA4 alpha-2 countries map through a versioned canonical country table; device normalization is explicit and tested.
- URL normalization is conservative and preserves verified aliases, locales and meaningful query strings.

### 2.3. URL Inspection

- The indexed-version response is parsed into a typed nullable contract.
- Inspection history stores verdict, coverage, last crawl, fetch, robots, indexing, Google canonical, user canonical, result link and inspection time.
- `UNKNOWN`, `WAITING_FOR_OBSERVED_RECRAWL`, `POST_PUBLISH_CRAWL_OBSERVED` and `TECHNICAL_REVIEW_REQUIRED` are derived without turning missing fields into success.
- Evaluation compares crawl evidence with the version's `public_effective_at_utc` where available.
- Newly published, warning and waiting URLs are prioritized; opening a page never fans out one external request per row.
- Quota is reserved atomically with configurable headroom; URL Inspection is never presented as live test or Request Indexing.
- A technical/indexing issue does not automatically produce a content rewrite recommendation.

### 2.4. GA4

- OAuth includes `analytics.readonly`; legacy GSC-only grants are marked for explicit re-consent instead of assumed sufficient.
- Mapping uses a numeric GA4 Property ID, verified store hostname/stream scope, property timezone and currency.
- `getMetadata` and `checkCompatibility` guard each metric/dimension contract; incompatible panels become separate reports.
- The default landing KPI is Google Organic Sessions using exact session acquisition filters.
- Landing sessions/users/engagement, landing event counts, landing revenue and item performance remain separate datasets and labels.
- Event counts are not described as a verified sequential funnel; landing revenue is not described as item revenue.
- Stable dimension ordering, `limit`/`offset`, response `rowCount` and returned property quota govern pagination.
- Thresholding, sampling, `(other)`, data loss, truncation, timezone, currency and freshness are stored as quality metadata.
- APIs and the minimal operations UI expose those quality flags and distinguish finalized, preliminary, stale, partial and unavailable data; persistence alone is not sufficient.
- Mapping tests verify whether `view_item`, `add_to_cart`, `begin_checkout` and `purchase` are actually observed. Missing instrumentation is unavailable/no-data, not an observed zero.
- Item quantities such as `itemsViewed` remain distinct from event counts such as `view_item`.
- `itemId` is never assumed to equal a Shopify Product GID. Product-level item panels require temporal, evidence-backed mapping; ambiguous mappings return `ITEM_MAPPING_AMBIGUOUS`/N/A and cannot influence the benchmark or recommendation.
- Shared acquisition support may retain `sessionSourceMedium`, `sessionCampaignName` and `sessionManualAdContent`, but those fields never enter the default Google Organic benchmark.
- A GSC query filter never silently applies to GA4; the GA4 result is explicitly unsupported/N/A for that filter.

### 2.5. Sync, cache, quota and freshness

- Durable jobs exist for GSC backfill/incremental, GA4 backfill/incremental, URL Inspection, benchmark evaluation, recommendation evaluation and sync health.
- Initial approved backfill defaults to 90 days; GSC and GA4 reprocess the most recent seven days by default.
- Work is partitioned and idempotent. A retry replaces the same partition rather than adding duplicate facts.
- One provider/store failure does not block unrelated stores indefinitely; concurrency is provider- and property-aware.
- 401/revocation, 403 permission/API/quota, 429, `Retry-After`, 5xx, timeout and invalid-request errors have distinct bounded behavior.
- Failed pagination never exposes a half-written partition as complete.
- Last successful sync is not advanced by a failed retry.
- Freshness is source-specific and exposes `data_through`, `fetched_at`, `last_successful_sync`, quality and stale reason.
- Cache keys contain store, mapping revision, provider/property, metric contract, filters, windows, compared versions and data revision.
- API/UI reads PostgreSQL summaries first and does not call Google once per displayed row.

### 2.6. Version-aware benchmark

- Calendar comparison and version comparison are separate modes with explicit labels.
- Version comparison reads the authoritative `seo_versions`, immutable snapshots, URL history, public-effective time and external-change intervals through the versioning public API.
- The current publish path must be extended to record a justified `public_effective_at_utc`. If that time is absent, the version benchmark is ineligible with `PUBLIC_EFFECTIVE_TIME_UNKNOWN`; it must never silently fall back to `applied_at_utc`.
- `v0` shows raw metrics but never a version delta.
- Before and After windows contain equal full source-timezone days, exclude publish day and settling days, and never include a newer version's interval.
- GSC uses `America/Los_Angeles` with daylight saving; GA4 uses the mapped property timezone.
- The default policy is 7-day settling, 7/14-day checkpoints and a 28-day recommendation window.
- Optional crawl-aware start uses the first FFP-observed post-publish crawl and stores that decision; it never slides forward with every newer inspection.
- Missing baseline, partial days, short-lived versions, external drift and ambiguous mappings remain ineligible with reason codes.
- Historical performance before FFP's first observed snapshot stores `baseline_content_observed_from`, `historical_performance_available` and `historical_content_verified`; it is labelled `HISTORICAL_CONTENT_UNVERIFIED` unless evidence proves the content interval.
- Version windows accept auditable annotations for sale, price, inventory, theme, redirect, tracking, campaign and other context changes. These annotations affect eligibility/reasoning without rewriting source facts.
- CTR is ratio-of-sums and delta is percentage points; position improvement is Before minus After; zero, missing and N/A remain distinct.
- Query differences are labelled observed/newly observed/no longer observed, never total keyword inventory or certain lost rankings.
- Batch totals use eligible cohorts and aggregate numerators/denominators, not averages of product percentages.
- Every result is immutable/versioned by ruleset, metric contract, data revision, filters and calculation time.

### 2.7. Recommendation and Auto-SEO feedback

- The engine keeps `data_status`, `measurement_status`, `performance_status` and `technical_flags` separate.
- It evaluates in the parent-specified order: source/mapping → content purity → technical state → version eligibility → crawl → coverage/volume → performance/action.
- Rules are deterministic, configurable and versioned. The initial thresholds are product defaults, not Google standards or causal proof.
- The initial `rules_v1` freezes: main window 28 days; minimum impressions signal 300 in at least one period; minimum clicks for the click rule 20 in at least one period; click change threshold 20 percent plus at least 10 absolute clicks; cooldown 28 days. `Before=0` never uses a percentage rule and becomes `NEW_ACTIVITY` for review.
- Diagnostic precedence is explicit: CTR/query mix → matched-query position/click movement → data/indexability → conversion/tracking/CRO → store-wide context. GA4 purchase decline alone and query-count change alone cannot request re-SEO.
- Partial, stale, low-volume, disconnected, technical and ambiguous states cannot automatically become rewrite recommendations.
- Recommendations deduplicate by store/product/version/reason/ruleset, respect cooldown/snooze/dismiss and stop when a draft or publish job is open.
- Sending re-checks store access, current version, content hash, recommendation validity, cooldown and open work in one protected transaction.
- The action creates a new Auto-SEO draft job only. It cannot approve, publish or increment the SEO version.
- The existing three-input SEO Content contract and source-version fencing continue to pass.
- Lifecycle states and transitions are explicit: `PROPOSED → DRAFT_QUEUED → DRAFT_READY → APPLIED_CLOSED`; `DISMISSED`, `SNOOZED`, `STALE`, `DRAFT_FAILED`, `DRAFT_CANCELLED` and `NO_CHANGE_CLOSED` are terminal or retry-policy states. A recommendation does not close merely because a job was enqueued; successful verified apply closes it and starts a new observation cycle.

### 2.8. Evidence and rollout

- Focused unit/integration tests, full repository tests, typecheck, production build and mock build pass with fresh output.
- PostgreSQL 17 Docker tests cover migrations, isolation, locking, retry and rollback; PGlite alone is insufficient.
- Chrome acceptance covers connection, mapping, sync/freshness, stale/error states, benchmark insufficiency and controlled Send to Auto-SEO.
- A read-only `jeminise` pilot is reconciled against GSC and GA4 UIs using identical property, dates, filters, timezone and metric definitions.
- Real 28-day impact is not fabricated. If data is immature, the report says `28-day live impact observation: pending data maturity` and uses clearly labelled fixtures only for calculation tests.

---

## 3. Current-state audit and gap map

The existing subsystem must be extended rather than replaced.

| Capability | Existing implementation | Required change |
| --- | --- | --- |
| GSC OAuth | Secure state, cookie binding, encrypted refresh token and `webmasters.readonly` in `gateway/seo-performance/google-client.ts` | Migrate singleton connection to connection records; add GA4 scope/account/granted-scope metadata and safe re-consent. |
| Store mapping | GSC property + storefront origin in `sp_mappings` | Add independent GSC/GA4 connection references, GA4 mapping, timezone/currency/hostname/stream and revisions. |
| GSC daily sync | Property/page/page-query, 90-day initial and 7-day overlap in `worker.ts` | Add normalized sync runs/partitions, durable quality/freshness and country/device slices required by benchmarks. |
| GSC interactive report | Total/date/query/page/country/device, filters, pagination and cache in `report.ts` | Preserve compatibility; move shared query contracts behind typed provider interfaces and data revisions. |
| URL Inspection | Read-only call, one-day cache and quota reservation | Validate/normalize the response, retain history and compare it with version publish time. |
| GA4 | Not implemented | Add OAuth consent, mapping, clients, datasets, sync, quota metadata and tests. |
| Jobs/cache | Durable jobs, checkpoints, advisory lock, retry and cached SQL reads | Split provider work fairly, honor `Retry-After`, add health/dead-job recovery and source-specific freshness. |
| Comparison | Calendar current-versus-previous periods | Add immutable version-aligned benchmark runs using the SEO version ledger. |
| Public-effective time | Nullable column exists in versioning, but the current publish integration does not populate it | A0 must add and verify the publish/public observation contract; missing time blocks a version benchmark. |
| Opportunities | GSC/audit heuristics and MCP proposals | Add deterministic version-aware engine, layered statuses, cooldown and suppression. |
| Auto-SEO bridge | Operator `revise` action creates `performance:<recommendationId>` job | Add version/hash/cooldown/open-job transaction checks while preserving the three-input SEO Content contract. |
| UI | Existing `/seo-performance` GSC report/audit/recommendation page | Only add minimal connection/mapping/sync states needed to operate this phase; final dashboard remains workstream 3. |

### 3.1. Conflict hotspots

The following files must have one integration owner; parallel agents must not edit them simultaneously:

- `gateway/seo-performance/schema.ts`
- `gateway/seo-performance/repository.ts`
- `gateway/seo-performance/runtime.ts`
- `gateway/seo-performance/worker.ts`
- `gateway/seo-performance/http-handler.ts`
- `src/modules/seo-performance/types.ts`
- `src/config/seo-performance-environment.ts`

The current `PERFORMANCE_SCHEMA_SQL` is an initialization script, not a sufficient migration ledger. Add versioned, idempotent migrations before evolving production tables.

---

## 4. Target boundaries and data ownership

### 4.1. Dependency direction

```text
src/modules/seo-performance UI/client
        ↓ typed HTTP contracts
gateway/seo-performance application service
        ↓
provider clients ─ sync scheduler ─ benchmark engine ─ recommendation engine
        ↓                  ↓                ↓
Google APIs          PostgreSQL facts   SEO versioning public API
                                             ↓
                          orchestrator revision bridge → Auto-SEO queue
```

- The browser never sees Google secrets or chooses an arbitrary property for a report.
- Provider clients do transport and validation, not benchmark business logic.
- The repository owns persistence and tenant predicates.
- The benchmark engine reads facts and immutable version data; it does not call Google.
- The recommendation engine consumes persisted benchmark output; it does not publish.
- The orchestrator imports supported module/public APIs only and keeps SEO Content input construction unchanged.

### 4.2. Logical datasets

Do not place all providers into the existing `sp_metrics` shape. Preserve these logical grains:

| Dataset | Minimum grain |
| --- | --- |
| GSC property totals | property + date + filter slice |
| GSC page metrics | property + date + normalized page + country/device slice |
| GSC observed queries | property + date + page + query + country/device slice |
| GA4 landing metrics | property + date/range + verified landing scope + session acquisition filters |
| GA4 event counts | landing scope + event name + date/range |
| GA4 item metrics | property + item ID + date/range + compatible acquisition scope + temporal product-mapping evidence |
| URL Inspection history | property + URL + inspection timestamp |
| Benchmark run | store + product + comparison mode + version pair + exact windows + data revisions |

Every fact/partition records provider, mapping revision, query signature, filter signature, grain, aggregation, source timezone, fetched time, coverage/quality and sync run.

### 4.3. Additive schema direction

Exact names may follow repository convention, but the meanings may not be removed:

- `sp_schema_migrations`
- `sp_google_connections`
- `sp_store_integrations`
- `sp_sync_runs`
- `sp_sync_partitions`
- provider-specific GSC fact tables or a rigorously typed equivalent
- `sp_ga4_landing_facts`
- `sp_ga4_event_facts`
- `sp_ga4_item_facts`
- `sp_inspection_history`
- `sp_benchmark_runs`
- `sp_benchmark_metrics` or typed JSON with enforced schema/version
- benchmark annotations and explicit historical-content verification fields
- evolved `sp_recommendations` with version/rules/cooldown lifecycle

Migration rules:

1. Add new tables/columns without dropping current `sp_*` data.
2. Backfill the current singleton connection and mappings into new records.
3. Dual-read for one release where necessary; all new writes use the new contract.
4. Verify row counts, store isolation and decryptability before cutover.
5. Keep a feature rollback that disables new jobs while preserving historical facts.
6. Remove legacy tables only in a separately approved cleanup after production verification.

---

## 5. Frozen V1 product decisions

These decisions follow the parent document and reduce implementation ambiguity:

- Pilot: `jeminise`, after exact public origin/GSC/GA4 mappings are confirmed.
- Google permissions: read-only GSC and Analytics; Admin API property discovery is optional.
- GA4 V1 configuration: manual numeric Property ID is sufficient; an Admin API picker is a later enhancement unless the owner explicitly requests it.
- BigQuery: disabled in V1. PostgreSQL remains the operational store.
- GSC search type: `web`; data state: `final`.
- Initial backfill: 90 days after explicit mapping confirmation.
- Reprocessing lookback: 7 recent days for both GSC and GA4.
- Benchmark checkpoints: 7 and 14 days; recommendation window: 28 days.
- Settling period: 7 days; recommendation cooldown: 28 days.
- Initial `rules_v1`: 300 minimum impressions signal, 20 minimum clicks for click rules, 20 percent and 10 absolute-click change thresholds; `Before=0` is `NEW_ACTIVITY`, not infinite growth.
- Default GA4 traffic: `sessionSource=google` and `sessionMedium=organic`.
- The current GSC report and audit behavior stays compatible while the new contracts are introduced.
- Full Search Overview, Product Detail, Batch Detail and final visual polish belong to the Dashboard UI workstream.
- Publish remains disabled during this workstream's integration QA.

---

## 6. Team-agent model

The team runs with one lead and at most three implementation agents concurrently. Each agent receives the exact protocol required by `AGENTS.md`: ownership, branch, expected behavior, contract impact, tests and forbidden files.

### A0 — Lead / contract and integration owner

**Branch:** `feature/gateway-integrate-performance-data`

**Owns:**

- contract decision record and merge sequencing;
- conflict-hotspot files listed in section 3.1;
- final schema migrations and repository integration;
- provider interfaces, runtime composition and final cross-agent QA;
- compatibility with SEO versioning and the three-input SEO Content contract.
- versioning publish/public-effectiveness integration and the `PUBLIC_EFFECTIVE_TIME_UNKNOWN` gate.

**Acceptance:**

- freezes types before parallel work;
- integrates by cherry-picking reviewed commits in dependency order;
- resolves mainline/versioning divergence before implementation;
- proves a verified publish records the public-effective timestamp, while unknown storefront effectiveness remains explicitly ineligible;
- rejects cross-store, secret leakage or input-contract regressions.

**Must not:** build provider-specific transformations that belong to A2/A3/A4, redesign the dashboard, or merge into `main` without leader instruction.

### A1 — Google identity, mappings and migrations

**Branch:** `feature/gateway-add-store-google-integrations`

**Owns:**

- versioned performance migrations;
- Google connection and per-store integration records;
- OAuth token lifecycle, scopes and reconnect states;
- migration from hand-written OAuth exchange to a maintained server-side OAuth library selected and approved at G0;
- typed environment parsing and secret-free `.env.example` entries;
- mapping/test APIs and focused database/OAuth tests.

**Public changes allowed:** additive gateway HTTP/types/environment contracts approved by A0, plus the G0-approved OAuth dependency and generated lockfile update. No other dependency change is allowed.

**Acceptance:** supports shared or separate GSC/GA4 connections, preserves refresh tokens, migrates legacy connection/mappings, isolates stores and rolls back safely; the production runbook verifies OAuth audience/publishing/verification state so seven-day Testing tokens are not misdiagnosed as data loss.

**Forbidden:** GSC/GA4 metric ingestion, benchmark formulas, recommendation logic, full UI, Auto-SEO changes.

### A2 — GSC Search Analytics ingestion

**Branch:** `feature/gateway-complete-gsc-ingestion`

**Owns after A1 merge:**

- GSC provider adapter and schemas;
- G01–G05 request builders;
- daily/backfill partition ingestion and GSC quality metadata;
- GSC reconciliation script extensions and focused tests.

**Acceptance:** pagination, final-day watermark, totals independence, raw property identifier/one-time encoding, in-property URL probe, overlapping-property isolation, canonical country/device mapping, provider-limit labels and atomic partition replacement match the parent specification.

**Forbidden:** OAuth persistence, GA4, URL Inspection rules, benchmark classification, UI redesign, SEO Content.

### A3 — GA4 Data API integration

**Branch:** `feature/gateway-add-ga4-ingestion`

**Owns after A1 merge:**

- GA4 Data API transport, metadata and compatibility guards;
- landing, engagement, event and item report contracts;
- evidence-backed temporal `itemId` to store/product mappings with ambiguity held as `ITEM_MAPPING_AMBIGUOUS`;
- pagination/quota/quality metadata;
- GA4 backfill/incremental handlers;
- deterministic provider fixtures and real-data reconciliation script.

**Acceptance:** exact Google Organic filter, verified hostname scope, separate compatible reports, instrumentation availability, item-mapping ambiguity, event-versus-item units, Acquisition/Ads compatibility kept separate, correct non-additive metric treatment, quality flags exposed to API/UI and explicit unsupported GSC-query filter behavior.

**Forbidden:** OAuth schema, GSC code, benchmark scoring, dashboard redesign, causal attribution labels.

### A4 — URL Inspection and technical evidence

**Branch:** `feature/gateway-version-url-inspection`

**Owns after A1 merge:**

- typed URL Inspection response and history persistence adapter;
- quota/headroom and priority policy;
- version-aware crawl state derivation;
- focused null/unknown/canonical/fetch/robots/quota tests.

**Acceptance:** history is append-only, missing fields remain unknown, publish-time comparison is correct and technical findings cannot directly request rewrite.

**Forbidden:** Search Analytics, GA4, benchmark performance rules, request-indexing features, UI redesign.

### A5 — Benchmark and status engine

**Branch:** `feature/gateway-calculate-seo-benchmarks`

**Owns after A2–A4 merge:**

- pure window selection and formula modules;
- immutable benchmark persistence;
- versioning public-API adapter;
- layered data/measurement/performance/technical statuses;
- cohort aggregation and deterministic ruleset tests.

**Acceptance:** DST/timezone, equal windows, publish/settling exclusion, crawl-aware option, overlapping versions, historical-content verification, operational annotations, external changes, v0, zero/missing/N/A, CTR pp, weighted position and observed-query semantics all pass.

**Forbidden:** provider HTTP calls, OAuth, product content generation, recommendation enqueue, UI redesign.

### A6 — Recommendation lifecycle and Auto-SEO handoff

This boundary is split into two commits so gateway and orchestrator ownership remain reviewable.

**Gateway branch:** `feature/gateway-generate-seo-recommendations`

**Orchestrator branch:** `feature/orchestrator-send-performance-revisions`

**Owns:**

- deterministic recommendation creation from eligible benchmark runs;
- deduplication, cooldown, snooze, dismiss and open-work gates;
- store/version/hash revalidation during Send to Auto-SEO;
- workflow metadata bridge and tests proving only a draft job is created.

**Acceptance:** the same facts/config produce the same reason under the frozen `rules_v1` decision table; stale or technical-only evidence cannot enqueue; concurrent sends create one job; enqueue does not close a recommendation; verified apply/no-change/failure/cancel/stale transitions are tested; SEO Content still receives only images, niche and store profile.

**Forbidden:** approval, Shopify write, version commit, direct changes to SEO Content public types, automatic bulk rewrite.

### A7 — Scheduler, API and minimal operations UI

**Gateway branch:** `feature/gateway-orchestrate-performance-sync`

**Main/UI branch:** `feature/main-connect-performance-sources`

**Owns after provider contracts stabilize:**

- provider-aware scheduler, fair concurrency, dead-job recovery, health and cache invalidation;
- stable integration/sync/job/benchmark/GA4/recommendation HTTP contracts;
- minimal Connections & Sync controls and status/error/freshness presentation;
- compatibility of the existing GSC dashboard.

**Acceptance:** no external N+1 requests, stale values are labelled, filters cannot return another cache slice, source-specific errors are actionable and feature-off leaves existing modules healthy.

**Forbidden:** final dashboard layouts/charts, provider metric formulas, secret display, publish controls.

### A8 — QA, security and real-data reconciliation

**Branch:** `test/gateway-verify-performance-integrations`

**Owns:**

- cross-provider fixtures and contract tests;
- PostgreSQL 17 Docker integration/recovery tests;
- tenant/RBAC/cache isolation and secret-redaction tests;
- Chrome acceptance checklist and evidence template;
- read-only GSC/GA4 pilot scripts, test report and operating runbook.

**Acceptance:** all gates in sections 9–11 have fresh evidence and discrepancies are explained by exact scope/definition, never by a blanket tolerance.

**Forbidden:** changing business rules to make tests pass, embedding credentials, production writes, approving or publishing products.

---

## 7. Execution waves and merge gates

### Wave 0 — Reconcile and freeze

1. A0 fetches latest remote state and creates the integration branch from the agreed integration base.
2. Reconcile latest `origin/main` with local SEO Content/versioning commits without rewriting shared history.
3. Run the full baseline suite before feature edits.
4. Freeze provider interfaces, migration policy, IDs, status enums, query/filter signatures and public API semantics.
5. Select the maintained OAuth library and approve its dependency/lockfile change before A1 begins.
6. Freeze the public-effective timestamp source and unknown-time eligibility rule with the versioning owner.
7. Record exact pilot store/domain/properties through the approved secret/config channel.

**Gate G0:** clean baseline, no lost versioning/mainline behavior, approved contracts, no credentials in Git.

### Wave 1 — Identity and persistence foundation

A1 implements migrations, OAuth connections and store mappings. A0 integrates and runs migration/reconnect/isolation tests before other branches start.

**Gate G1:** legacy GSC mapping still reads, GA4 consent can be requested, shared/separate connection references work, rollback tested.

### Wave 2 — Provider ingestion in parallel

After G1, run A2, A3 and A4 concurrently. They use frozen interfaces and add provider-owned files/tests; they do not edit conflict hotspots without A0 coordination.

**Gate G2:**

- GSC fixture reconciliation and pagination pass.
- GA4 landing/event/item fixtures and quota metadata pass.
- Inspection typed/history/version states pass.
- Reprocessing is idempotent and failed partitions stay incomplete.

### Wave 3 — Scheduling and benchmark

1. A7 integrates provider jobs, fairness, freshness and stable read APIs.
2. A5 implements the pure benchmark/status engine against persisted facts and versioning contracts.
3. A0 validates data revision/cache invalidation across both.

**Gate G3:** 7/14/28 calculations are deterministic; stale/partial/ambiguous data cannot become eligible; no Google call occurs during benchmark calculation.

### Wave 4 — Recommendation feedback

A6 adds the recommendation lifecycle and then the orchestrator handoff. A0 verifies that no field leaked into the SEO Content semantic input and no route can approve/publish.

**Gate G4:** one valid operator action creates one fenced draft job; stale/current-version mismatch, cooldown and open work block it safely.

### Wave 5 — Minimal operations UI and full QA

1. A7 adds only the required connection/mapping/sync/freshness operational UI.
2. A8 runs deterministic, PostgreSQL, fault, security, load and Chrome suites.
3. A8 performs the read-only pilot reconciliation after the owner supplies credentials/mappings.
4. A0 writes the final handoff and remaining limitations.

**Gate G5:** all automated commands and acceptance matrices pass; production remains disabled until a separate activation decision.

---

## 8. API contract direction

Keep the current `/api/seo-performance/` prefix for compatibility. Add/adapt routes by capability rather than cloning the parent document literally:

| Method / logical route | Contract |
| --- | --- |
| `GET integrations?storeId=` | Per-source connection, mapping, permission, revision and freshness state. |
| `POST oauth/start` | Starts consent for requested read-only source set; returns authorization URL only. |
| `GET oauth/callback` | Validates single-use state/session and stores encrypted grant. |
| `GET properties?source=` | Lists GSC properties; optional GA4 Admin discovery only if enabled. |
| `POST integrations/test` | Performs bounded READ test for the selected source/mapping. |
| `POST mapping` | Confirms exact GSC/GA4/store scope and increments mapping revision. |
| `POST sync` | Enqueues an authorized backfill or incremental sync. |
| `GET jobs/{jobId}` | Returns partition progress, freshness, retry and safe error details. |
| `POST report` | Preserves the current interactive GSC report contract. |
| `GET search-overview` | Stable store/property totals, trends, top slices, freshness and quality for the later dashboard. |
| `GET products` | Stable benchmark list with server-side filter, sort and pagination plus eligible/total counts. |
| `GET products/{product}/benchmark` | Returns calendar/version result, eligibility, versions, windows, statuses, quality and reasons. |
| `GET products/{product}/queries` | Returns matched/newly/no-longer-observed query evidence. |
| `GET products/{product}/ga4` | Returns separately labelled landing/event/item panels and filter applicability. |
| `GET batches/{batchId}` | Stable aligned cohort totals, exclusions and per-version window metadata. |
| `POST recommendations/{id}/send-to-auto-seo` | Creates a fenced draft request only. |
| `POST recommendations/{id}/dismiss` | Records actor/reason and suppression state. |

Rules for every route:

- authenticate and authorize the store server-side;
- never trust browser-supplied connection/property IDs without resolving them through the store mapping;
- use stable error codes and safe Vietnamese UI messages;
- serialize missing/N/A as `null` plus a reason, never zero;
- include source timestamps, coverage, data revision and action permissions;
- expose finalized/preliminary, thresholding, sampling, `(other)`, truncation and stale/partial/unavailable flags rather than hiding them until the dashboard phase;
- preserve existing route aliases during migration where needed.

---

## 9. Required test matrix

### 9.1. Unit and contract tests

- OAuth state expiry/replay/session binding and token encryption.
- Scope expansion and callback-without-refresh-token preservation.
- Mapping revision, shared/separate connections and cross-store denial.
- GSC G01–G05 builders, aggregation and filters.
- GSC pagination: multiple pages, empty final page, 25k/50k limits and failed middle page.
- Raw GSC property identity, one-time URL encoding, product URL membership, overlapping property isolation and alpha-3 country/device normalization.
- GA4 compatibility splitting, pagination by `rowCount`, stable ordering and exact organic filter.
- GA4 sessions/users/event/item non-additive semantics, event instrumentation availability, item mapping ambiguity, Acquisition separation and quality metadata.
- Inspection nullable fields, canonical mismatch, fetch/robots/indexing flags and quota.
- Source-specific freshness and cache signatures.
- Benchmark DST, equal windows, v0, unknown public-effective time, historical-content verification, annotations, baseline zero, missing data, external drift, short version, crawl-aware start, CTR pp and position direction.
- Recommendation `rules_v1` boundary cases, diagnostic precedence, lifecycle transitions, determinism, dedup, cooldown, snooze/dismiss and no-content-rewrite technical state.
- Auto-SEO handoff source version/hash/open-job fencing and three-input contract leakage guard.

### 9.2. PostgreSQL 17 integration tests

- Fresh migration, legacy migration, repeated migration and rollback/recovery.
- Unique/foreign/check constraints and append-only benchmark/inspection behavior.
- Concurrent partition writers and atomic replacement.
- Concurrent mapping changes versus running sync.
- Concurrent recommendation sends produce one job.
- Worker restart resumes checkpoints without duplicate facts.
- Store/property/cache isolation under identical URLs and filters.
- Revoked credentials preserve last known values but prevent new eligible recommendations.
- Verified publish records public-effective time; missing public-effective evidence blocks version attribution.

### 9.3. Fault tests

- 401 refresh success and invalid refresh reconnect state.
- Distinct 403 permission/API/quota handling.
- 429 with numeric/date `Retry-After`, jitter and bounded requeue.
- 5xx/timeout during every pagination page.
- Invalid provider schema/filter fails closed; filters are never dropped.
- Ambiguous hostname/path mapping holds GA4 benchmark.
- Ambiguous or unverified GA4 item mapping returns N/A and cannot influence a product recommendation.
- Missing row versus observed zero.
- Feature flag off leaves Queue, Review, SEO Content, versioning and Shopify sync operational.

### 9.4. Full repository commands

Every feature branch runs focused tests. Before each integration gate and final handoff run:

```bash
npm test
npm run typecheck
npm run build
npm run build:mock
```

Never report a command as passing without fresh output from the integrated commit.

---

## 10. Chrome and real-data acceptance

### 10.1. Chrome acceptance

Use `@Chrome` against the approved local/staging environment and record screenshots with secrets redacted:

1. Open SEO Performance for `jeminise`.
2. Confirm disconnected/configuration-required states are truthful.
3. Start OAuth and verify callback returns to the correct authenticated session.
4. Map the exact GSC property and numeric GA4 property; verify independent status and scope.
5. Start initial sync and observe queued/running/partial/done/error states.
6. Refresh/reopen and confirm progress/freshness survives navigation and restart.
7. Confirm stale data displays timestamp/reason and cannot create a new recommendation.
8. Confirm finalized/preliminary, thresholding, sampling, `(other)`, truncation, partial and unavailable quality states are visible when present.
9. Confirm GSC query filter marks GA4 unsupported rather than showing unfiltered GA4 as keyword data.
10. Open a v0 product and verify version delta is N/A; historical backfill is labelled unverified where applicable.
11. Open insufficient/collecting/eligible fixture cases and verify layered reasons.
12. Send one valid recommendation in the authorized test environment and verify exactly one Auto-SEO draft job appears.
13. Confirm no approval, publish or Shopify version increment occurred and the recommendation remains open until its defined lifecycle event.
14. Verify responsive layout and no horizontal overflow at desktop and narrow viewport.

### 10.2. Read-only pilot reconciliation

Required owner-provided inputs, delivered through secret/config management rather than chat or Git:

- Google OAuth client and exact redirect URI.
- Google identity with access to the selected GSC and GA4 properties.
- Exact GSC property identifier.
- Numeric GA4 Property ID, public hostname/stream scope, timezone and currency.
- An approved finalized date range and pilot product URLs.

For GSC, compare property totals, one exact page and returned queries using the same property, Web type, finalized dates, country/device/page/query filters and aggregation.

For GA4, compare the same property, date range, timezone, landing dimension, session acquisition filters and metric definition in Reports/Explore.

The non-destructive staging demo also records three negative cases: expired access token with successful refresh, wrong/out-of-scope property, and revoked refresh grant requiring reconnect. If the owner will not authorize revoking the pilot credential, use a dedicated test grant and record that limitation; do not break the production grant for demonstration.

Use this evidence table:

| Metric | Google UI | FFP | Difference | Exact scope/filter/aggregation | Explanation | Pass/Fail |
| --- | ---: | ---: | ---: | --- | --- | --- |
| Clicks | | | | | | |
| Impressions | | | | | | |
| CTR | | | | | | |
| Average Position | | | | | | |
| Google Organic Sessions | | | | | | |

Clicks/impressions must reconcile when both sides use the same dataset. CTR/position may differ only by display rounding. Every larger difference requires evidence; there is no generic “10% tolerance”. GSC clicks and GA4 sessions are never expected to equal each other.

---

## 11. Security, observability and rollback gates

### 11.1. Security

- Secrets stay backend-only and encrypted; no `VITE_` secret variables.
- Logs redact access/refresh tokens, authorization codes, cookies and full sensitive callback URLs.
- Viewer, Analyst, Publisher and Admin actions are mapped to the repository's actual auth model before rollout.
- Every data/action query includes tenant/store predicates.
- Provider text, product HTML and query text are untrusted data, never system instructions.
- Disconnect/revoke and retention behavior are audited.
- Before production activation, record OAuth audience/publishing/verification status and whether the grant is subject to the External-Testing seven-day refresh-token limit.

### 11.2. Observability

Record without sensitive payloads:

- jobs/partitions by provider, store, state and age;
- rows/pages fetched and partitions replaced;
- quota remaining/consumed where provided;
- retry cause, wait and terminal error class;
- data-through and freshness lag by dataset;
- cache hit/miss and calculation revision;
- benchmark eligible/excluded counts by reason;
- recommendations created/suppressed/sent/dismissed;
- Auto-SEO handoff idempotency and stale-fence failures.

### 11.3. Rollback

- Global and per-store source flags stop new jobs without deleting facts.
- Migration backup and restore are tested before production.
- Provider rollout order is GSC compatibility → GA4 pilot → benchmark read-only → recommendations visible → operator send enabled.
- A rollback disables new evaluator/recommendation jobs and returns to existing GSC report behavior.
- No rollback rewrites immutable SEO versions, benchmark runs or audit history.

---

## 12. Agent handoff and merge protocol

Each agent must provide:

```text
Summary
- <implemented behavior>

Changed files
- <path>: <reason>

Verification
- <focused command>: <result>
- npm test: <result>
- npm run typecheck: <result>
- npm run build: <result>
- npm run build:mock: <result when applicable>

Contract / environment / route changes
- <exact additive or compatibility note>

Remaining TODOs or risks
- <none, or specific item>
```

Before integration, A0 verifies:

- branch and commit naming follow `AGENTS.md`;
- only assigned files changed;
- module boundaries and public exports remain intentional;
- no `any`, ignored TypeScript error, secret or production record entered the diff;
- migrations are additive/idempotent and tenant-safe;
- errors preserve cause internally and expose safe codes externally;
- fixtures are deterministic and network-free;
- recommendation changes did not alter the SEO Content three-input contract;
- generated `dist/`, `node_modules/`, `.env.local`, `.codex/` and local evidence are not committed.

---

## 13. Parent-specification traceability

| Parent requirement | Plan coverage | Primary owner / gate |
| --- | --- | --- |
| Sections 1–3: approved flow, read-only sources, stable IDs and source meanings | Sections 1, 2 and 4 | A0 / G0 |
| Step 3: Google Cloud, OAuth, GSC and GA4 mappings | Sections 2.1, 5, 6/A1 and 8 | A1 / G1 |
| Step 4: facts, inspection, benchmark, recommendations, sync records and invariants | Sections 4.2–4.3 | A0 + A1 / G1 |
| Step 7: G01–G05, pagination, finalized dates, URL/filter semantics and coverage | Sections 2.2, 6/A2 and 9 | A2 / G2 |
| Step 8: typed Inspection history, crawl states, priority and quota | Sections 2.3 and 6/A4 | A4 / G2 |
| Step 9: GA4 organic landing, engagement, event/item panels, pagination and metadata | Sections 2.4 and 6/A3 | A3 / G2 |
| Step 10: calendar/version windows, formulas, missing values, observed queries and cohorts | Sections 2.6 and 6/A5 | A5 / G3 |
| Step 11: layered status, ordered gates, versioned rules and loop prevention | Sections 2.7 and 6/A5–A6 | A5 + A6 / G3–G4 |
| Step 13: recommendation context and draft-only Auto-SEO feedback | Sections 1.1, 2.7 and 6/A6 | A6 / G4 |
| Step 14: scheduler, cache, quota, retry, stale data and security | Sections 2.5, 6/A7 and 11 | A7 + A8 / G3–G5 |
| Section 19: stable internal API contracts | Section 8 | A0 + A7 / G3 |
| Section 20: data, benchmark, recommendation, reconciliation, security and performance tests | Sections 9–11 | A8 / G5 |
| Section 21: real read-only data and honest pending-maturity demo | Section 10 | A8 / G5 |
| Section 22: add-store and operational runbook | Sections 10, 11 and 14 deliverables | A8 / G5 |
| Section 23: connectors, jobs, dictionary, evidence, limitations and technical completion | Sections 2, 14 and 16 | A0 / G5 |

---

## 14. Final deliverables

- Versioned Google connection/mapping migrations and rollback procedure.
- GSC, URL Inspection and GA4 connectors with typed contracts.
- Backfill/incremental scheduler, partitions, cache, quota and freshness monitoring.
- Metric dictionary covering source, grain, filters, aggregation, timezone and limitations.
- Immutable calendar/version benchmark engine and version-window policy.
- Deterministic recommendation lifecycle and controlled Auto-SEO draft bridge.
- Stable internal APIs for the later Dashboard UI workstream.
- Unit, PostgreSQL, fault, security, regression and Chrome test report.
- Redacted GSC/GA4 request-response evidence and UI reconciliation table.
- Runbook for new store, reconnect, remap, retry, rollback and data retention.
- Explicit limitation register, including hidden GSC queries, Inspection semantics, GA4 attribution, source lag and non-causal Before/After results.

---

## 15. Stop conditions requiring owner direction

Stop instead of guessing when:

- the exact `jeminise` public origin, GSC property or GA4 property/scope is unknown;
- the requested Google identity lacks property access or OAuth verification is unsuitable for long-lived refresh tokens;
- the repository auth model cannot express the required store/action permission;
- one GA4 property/stream contains multiple stores with ambiguous landing scope;
- a proposed change would add performance fields to the SEO Content input contract;
- a schema change would drop/rewrite existing `sp_*` or SEO version history;
- a real test would approve, publish or mutate Shopify without explicit authorization;
- the implementation requires BigQuery, a new external dependency or a shared abstraction not approved in the frozen contract.

---

## 16. Definition of done

The phase is technically done when a newly mapped store can:

```text
connect Google READ-only
    → map exact GSC and GA4 scopes
    → backfill and incrementally sync complete/quality-labelled facts
    → retain URL Inspection history
    → align facts with immutable SEO versions and URL intervals
    → produce a valid benchmark or an explicit ineligibility reason
    → create a deterministic, reviewable recommendation
    → let an authorized operator create one Auto-SEO draft job
    → preserve the SEO Content three-input contract
    → require normal human review before any Shopify write
```

Completion proves that the integration and evaluation machinery works. It does not prove that Auto-SEO caused a business uplift, that every Google query is observable, or that GSC clicks must equal GA4 sessions.
