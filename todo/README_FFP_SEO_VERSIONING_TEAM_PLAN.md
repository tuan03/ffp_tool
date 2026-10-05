# FFP SEO Versioning — Team Agents Implementation Plan

**Document status:** Implementation source of truth for the Versioning workstream

**Document version:** 1.0

**Created:** 05/10/2026

**Parent specification:** `todo/README_FFP_SEO_BENCHMARK.md`

**Repository:** FFP Tool

**Recommended pilot:** `jeminise` / `b6-theme-test.myshopify.com`
**Required base:** current code after commit `7d1c178` or the `main` commit that contains it

> This document is a plan, not evidence that versioning has been implemented. The work is complete only when every required automated, PostgreSQL, MCP, Shopify-read and Chrome acceptance gate below has fresh passing evidence. No production migration, approval or Shopify write is authorized by this plan.

---

## 1. Executive answer and scope split

The requirements in `README_FFP_SEO_BENCHMARK.md` can be organized into three major workstreams:

1. **SEO Versioning and Shopify lifecycle**
   - Product registry and exactly one `v0` baseline.
   - Immutable content snapshots and URL history.
   - Draft base-version fencing, approval and protected publish.
   - Read-back verification before `vN+1` is committed.
   - No-change, partial/uncertain write reconciliation, external drift and rollback.
2. **GSC/GA4 integration and the data/benchmark engine**
   - Google OAuth, GSC Search Analytics, URL Inspection and GA4 Data API.
   - Normalized facts, mapping, freshness, benchmark windows, eligibility, status rules and recommendations.
3. **Dashboard UI**
   - Connections & Sync, Search Overview, SEO Benchmark, Product Detail and Batch Detail.

This split is valid, but the three workstreams are not independent:

```text
Versioning foundation
    ↓ stable product/version/snapshot/URL/timestamp contracts
GSC + GA4 + benchmark engine
    ↓ stable metrics/eligibility/recommendation contracts
Dashboard UI and feedback actions
```

The current document implements only workstream 1. It must publish stable read contracts and lifecycle events for workstreams 2 and 3, but must not implement GA4/GSC ingestion, benchmark formulas or the full dashboard.

The step-by-step source remains the parent benchmark document:

- Business/version rules: sections 1.1–1.4.
- Discovery and Shopify preparation: steps 1–2.
- Schema and snapshots: step 4.
- Product feed and `v0`: step 5.
- Draft/approve/apply/version lifecycle: step 6.
- Version-window dependencies: step 10.
- Version-facing UI/API contracts: steps 12, 13 and 19.
- Acceptance and real-data demo: sections 20–23.

---

## 2. Objective

Build one authoritative SEO versioning domain around the current durable publish pipeline so that FFP can answer, for every managed Shopify product:

- What is the current committed SEO version?
- What exact content snapshot belongs to each version?
- Which snapshot and version was a draft based on?
- What changed during an approved publish?
- Was the remote write fully verified, a no-op, partial, uncertain or blocked?
- Did Shopify content drift outside FFP after a committed version?
- If an old snapshot is restored, which new forward-moving version represents that rollback?
- Which URL and public-effective interval may later receive GSC/GA4 facts?

The required lifecycle is:

```text
Shopify catalog discovery
    ↓
ensureProductBaseline → immutable snapshot → v0
    ↓
Auto-SEO draft based on version/hash
    ↓
human review and approval
    ↓
idempotent publish operation + product fence
    ↓
pre-write live read/hash check
    ├─ no effective change → NO_CHANGE, no version
    ├─ conflict → CONTENT_CONFLICT, no write/version
    └─ approved write
           ↓
       read-back verification
           ├─ exact verified result → immutable after snapshot → vN+1
           └─ partial/unknown result → reconciliation, no successful version
```

Version numbers never move backward and committed snapshots are never overwritten.

---

## 3. Completion definition

Versioning is complete only when all statements below are true.

### 3.1. Product and baseline

- Every in-scope product is keyed by `(store_id, shopify_product_gid)`.
- The first successful observation creates exactly one `v0` and one immutable content snapshot in the same transaction.
- Initial sync, scheduled reconciliation, manual refresh and duplicate webhook delivery share the same idempotent baseline operation.
- Concurrent baseline workers cannot create two `v0` rows.
- Draft, archived, unpublished and deleted products retain history; only their benchmark/public eligibility changes.
- `v0` means “first baseline observed by FFP”, not proof that the product was never previously optimized.
- Unknown history is represented explicitly by `prior_history_unknown=true`.

### 3.2. Draft and publish

- Draft generation/regeneration never increments the committed version.
- Every draft is fenced by `based_on_version_id`, `based_on_snapshot_id` and `based_on_content_hash`.
- Only approved allowlisted fields can enter a publish operation.
- Shopify is read immediately before write; a changed canonical content hash returns `CONTENT_CONFLICT`.
- A no-op produces an auditable `NO_CHANGE` receipt and no new version.
- A verified full write commits exactly one `vN+1` with predecessor, before/after snapshots, operation, actor and provenance.
- HTTP 200 with GraphQL errors or `userErrors` is not success.
- Timeout, partial write, lost response or database failure after a possible remote write never causes a blind resend or duplicate version.
- Two concurrent publishers for one store/product cannot both write or allocate a version.
- Handle, URL, price, inventory, variants, status, shipping, tags and collections are never changed by this workflow.

### 3.3. History, drift and rollback

- Committed content snapshots and version records are immutable.
- Manual/import/external content changes create an observed snapshot and `external_change` event; they do not rewrite or automatically increment the FFP version.
- A dirty interval is exposed to the future benchmark engine so mixed-content windows are not treated as clean version performance.
- Rollback means “create a new approved publish from an older snapshot”. It creates `vN+1`, sets `source=ROLLBACK` and records `restored_from_version_id`; it never changes current version back to an old number.
- Product version history and field/media diff are store-scoped, paginated and deterministic.

### 3.4. Safety and evidence

- PostgreSQL is the authoritative ledger; Shopify `custom.seo_version` is a remote mirror/fence, not a replacement database.
- Existing durable publish guarantees remain intact: review fingerprint, idempotency, lease fencing, read-before-write, read-after-write, uncertain reconciliation and one active operation per product.
- The old browser/orchestrator version allocator cannot race the durable publisher after cutover.
- Versioning is disabled by default and can be enabled per pilot store; global publish remains protected by `SEO_WORKER_PUBLISH_ENABLED`.
- MCP workers can create drafts but cannot approve, publish, reconcile or commit versions.
- No production write is part of implementation QA unless the user explicitly authorizes a named pilot product and operator.
- `npm test`, `npm run typecheck`, `npm run build` and `npm run build:mock` pass with fresh output.

---

## 4. Non-goals

This versioning workstream does not:

- Build Google OAuth, GSC, URL Inspection or GA4 connectors.
- Implement benchmark date-window formulas, status rules or recommendation scoring.
- Build the complete SEO Benchmark dashboard.
- Infer historical content before FFP's first observation.
- Claim causality between a version and traffic changes.
- Change the SEO Content V2 semantic input contract.
- Give Codex MCP an approval, Shopify mutation or database administration tool.
- Replace the current queue, Review delivery, worker protocol or durable publisher without a demonstrated incompatibility.
- Reconstruct missing snapshots with AI.
- Automatically publish, rollback or repair external drift.
- Deploy, migrate production, enable a store or mutate a real Shopify product without separate explicit authorization.

---

## 5. Current-state audit

Versioning must be an incremental extension, not a greenfield rewrite.

### 5.1. Existing capabilities to reuse

| Existing capability | Current location | Required treatment |
| --- | --- | --- |
| Durable publish operation and leases | `gateway/seo-worker/publish-repository.ts` | Extend; do not replace. |
| Read-before-write/read-after-write reconciliation | `gateway/seo-worker/publish-worker.ts` | Preserve and integrate with snapshots. |
| Shopify allowlisted transport | `gateway/seo-worker/publish-transport.ts` | Extend read model/pagination; keep write allowlist. |
| Publish tables and unique active product guard | `gateway/seo-worker/publish-schema.ts` | Additive migration only. |
| Local publish-version receipt | `seo_publish_versions` | Retain as operation receipt; link it to the new authoritative domain version. |
| Shopify mirror version | `custom.seo_version` | Keep as remote fence/mirror. |
| Operator publish/reconcile routes | `gateway/seo-worker/admin-handler.ts` | Reuse; add version routes through one controlled integration point. |
| Review/job revision lineage | `gateway/seo-worker/revision-*` | Link drafts to base version/hash. |
| Worker Review history | `gateway/seo-worker/review-history.ts` | Keep separate from immutable content-version history. |
| Contract/profile/pipeline/checkpoint versions | SEO Content V2 files | Record provenance on published versions; do not confuse them with product SEO version. |
| Global publish kill switch | `SEO_WORKER_PUBLISH_ENABLED` | Retain; add per-store versioning gates. |
| PostgreSQL/PGlite test infrastructure | Gateway tests | Reuse for concurrency and recovery tests. |

### 5.2. Gaps against the benchmark specification

| Required behavior | Current gap |
| --- | --- |
| Exactly one `v0` for every discovered product | No authoritative product registry/baseline operation. |
| Immutable content snapshot per version | Current publish receipt stores frozen fields but not a complete version snapshot. |
| Version predecessor/source/actor/model/prompt/batch | `seo_publish_versions` currently stores only operation/store/product/version/confirmed time. |
| Draft base hash/version | Current source fencing relies mainly on Shopify `updatedAt` and Review fingerprint. |
| Canonical `NO_CHANGE` | First-pass publish still proceeds when intended fields already equal live fields. |
| External drift | No domain snapshot/event/dirty interval for changes outside FFP. |
| Business rollback | Existing rollback helpers are compensation paths, not forward-moving SEO version rollback. |
| Version list/diff API | Existing history is worker/job history, not immutable content history. |
| Media-complete baseline | Some current readers do not provide a full paginated media snapshot. |
| One version allocator | Durable publisher and legacy browser/orchestrator code can derive versions independently. |
| Numbered publish/version migration ledger | Queue startup currently applies additive DDL directly. |
| Per-store rollout gate | Global publish flag exists, but no complete versioning feature/cutover state. |

### 5.3. Important separation of version concepts

The implementation must use distinct names and fields for:

- `inputContractVersion`: SEO Content input contract, currently V2.
- `storeProfileVersion`: version of store-specific content policy.
- `pipelineVersion`: generation/runtime pipeline version.
- `promptVersion` and `modelId`: model provenance for a generated draft.
- `snapshotSchemaVersion`: canonical content snapshot shape/hash algorithm.
- `productSeoVersion`: `v0`, `v1`, `v2`, ... committed product history.
- `metricContractVersion` and `rulesetVersion`: owned later by benchmark/data work.

None of these may be silently substituted for another.

---

## 6. Decisions that the lead must freeze before implementation

The team lead records these decisions in the first implementation commit. Agents must not invent different answers independently.

| Decision | Recommended default for V1 |
| --- | --- |
| Authoritative version ledger | PostgreSQL. Shopify `custom.seo_version` is a mirror/fence. A mismatch blocks automatic write and requires reconciliation. |
| Base commit | Use the `main` commit containing SEO Content V2 commit `7d1c178`. If work starts earlier, use a stacked integration branch and record that exception. |
| Pilot | Jeminise, using a clone/test product unless a specific real product is separately approved. |
| Global flags | Keep `SEO_WORKER_PUBLISH_ENABLED`; add a server-side versioning availability flag only if needed. |
| Per-store flags | Persist `versioning_read_enabled` and `versioning_write_enabled`; READ/backfill is enabled before WRITE. |
| Versioned field set | Freeze as a named `field_set_version`. At minimum: title, description HTML, SEO title, SEO description and alt by Media GID. |
| AEO fields | Snapshot every field actually mutated. Decide explicitly whether AEO-only changes increment product SEO version; never leave this implicit. |
| Canonical hash | Versioned deterministic JSON; stable field order, LF line endings, media sorted by Media GID, null distinct from empty, no operational timestamps. |
| `NO_CHANGE` | Audit/receipt only; no version row and no Shopify write. |
| `public_effective_at` | Nullable until public visibility is verifiable. Never treat unpublished/draft content as public. |
| External edit | Create observed snapshot + drift event; do not auto-increment the FFP version. |
| Image retention | V1 must store Media GID, URL, alt and dimensions. Object-storage byte backup is a separate approved decision. |
| Rollback | Human-approved forward publish only; scope restricted to the same allowlist. |
| Operation terminology | Preserve current durable states internally where safe; map them to benchmark-facing statuses instead of risky destructive renames. |
| Legacy browser publish | Disabled for stores cut over to authoritative versioning; no silent fallback. |

Implementation pauses at Phase 0 if the owner rejects a recommended default and does not supply a replacement.

---

## 7. Target architecture

```text
Shopify connector / webhook / scheduled reconciliation
                         │ READ
                         ▼
              Canonical snapshot builder
              - full media pagination
              - field-set/schema version
              - deterministic content hash
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
      Baseline/drift service   Draft base resolver
      - ensure v0             - current version
      - observed snapshots    - snapshot/hash fence
              │                     │
              └──────────┬──────────┘
                         ▼
             Authoritative version repository
             - products
             - immutable snapshots
             - versions
             - draft bases
             - external changes/audit
                         │
                         ▼
          Existing durable publish repository/worker
          - approval + idempotency + product lease
          - pre-write live hash
          - no-change/content-conflict
          - Shopify write + read-back
          - exactly-one version commit
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
Version history/diff API       lifecycle events for future
and minimal Review adapter     GSC/GA4/benchmark/dashboard
```

### 7.1. Ownership boundaries

- Server-side version domain: new `gateway/seo-versioning/`.
- Existing publisher integration: `gateway/seo-worker/`.
- Shopify read/write operations: existing Gateway dispatcher/operations; no direct browser Shopify calls.
- Browser types/client for version history: new `src/modules/seo-versioning/` or an explicitly approved extension of `src/modules/custom-gpt-seo`.
- Application route registration remains in `src/app`; module UI is exported through its public `index.ts`.
- `src/shared` is used only if both gateway and at least two independent browser/module owners need one stable transport-neutral contract.
- No page imports `gateway/` internals.
- No SEO Content core file becomes responsible for product version allocation.

---

## 8. Target domain and persistence model

Exact table names may follow existing conventions, but semantics and constraints below are mandatory.

### 8.1. `seo_products`

Minimum fields:

```text
id
store_id
shopify_product_gid
current_version_id nullable during first transaction only
current_observed_snapshot_id
current_url
shopify_status
first_seen_at
last_seen_at
archived_at / deleted_at
prior_history_unknown
versioning_state
```

Constraints:

- Unique `(store_id, shopify_product_gid)`.
- Product identity never depends on title, handle or URL.
- Archive/delete is soft state; history remains.

### 8.2. `seo_content_snapshots`

Minimum payload:

```text
id, store_id, product_id
captured_at_utc, source
snapshot_schema_version, field_set_version, content_hash
title, description_html, seo_title, seo_description
images[] { media_gid, image_url, alt, width, height }
handle, online_store_url, observed_canonical_url
shopify_status, vendor, product_type, tags
extension_fields JSONB
```

Rules:

- The versioned hash includes only the frozen versioned field set.
- Context fields such as handle/tags may be stored for evidence but do not become writable.
- Null, empty and missing remain distinguishable where the Shopify contract distinguishes them.
- Media are compared by stable Media GID, never array position.
- Committed snapshots are immutable. A later observation creates a new row.
- Untrusted HTML is stored as evidence but rendered only through the existing sanitizer/raw-text modes.

### 8.3. `seo_versions`

Minimum fields:

```text
id, store_id, product_id
version_number
snapshot_id
before_snapshot_id nullable for v0
predecessor_version_id nullable for v0
source: BASELINE | AUTO_SEO | ROLLBACK | IMPORTED
publish_operation_id nullable for v0
restored_from_version_id nullable unless rollback
approved_by, applied_by
model_id, prompt_versions, pipeline_version, store_profile_version
batch_id / job_id
applied_at_utc
public_effective_at_utc nullable
created_at_utc
```

Constraints:

- Unique `(store_id, product_id, version_number)`.
- Exactly one version `0` per product.
- `vN` points to `vN-1` as predecessor except explicitly migrated history with a recorded quality flag.
- Version and linked committed snapshot cannot be updated or deleted through application repositories.

### 8.4. Draft bases

Do not duplicate the existing `gpt_jobs`/Review payload as a second draft store. Add a durable link such as `seo_draft_bases`:

```text
job_id primary key
store_id, product_id
based_on_version_id
based_on_snapshot_id
based_on_content_hash
input_contract_version
store_profile_version
created_at
```

Creation of a draft link does not increment the product version.

### 8.5. External changes and URL history

`seo_external_changes` records:

```text
store_id, product_id
committed_version_id
previous_observed_snapshot_id
observed_snapshot_id
observed_at
source/actor: EXTERNAL_UNKNOWN unless verified
changed_fields
resolved_at / resolution
```

`seo_product_url_history` records normalized/raw/canonical URL, alias type, mapping evidence and `valid_from`/`valid_to`. It is a required handoff to GSC/GA4 work, even if full analytics ingestion is deferred.

### 8.6. Existing publish tables

- Keep `seo_publish_operations` as the durable remote-operation state machine.
- Keep `seo_publish_versions` as a compatibility/exactly-once operation receipt.
- Add `seo_version_id` to the receipt or a unique link table.
- The same transaction that confirms read-back must create exactly one authoritative `seo_versions` row, link the receipt and advance `seo_products.current_version_id`.
- Baseline `v0` is created without a publish operation.
- Do not infer a missing local history count from a remote metafield. Import/mismatch requires an explicit migration decision and quality flag.

### 8.7. Migration discipline

- Add a numbered Gateway-owned migration ledger for versioning changes.
- Migrations are additive and rerunnable.
- DDL composition into `gateway/custom-gpt-seo/postgres-database.ts` is performed by the lead only after the schema agent's API is frozen.
- Production rollback means feature rollback and application rollback while preserving data. Do not drop collected history as a routine rollback.
- Down-migration/destructive restore is rehearsed only against an isolated staging clone with a verified backup.

---

## 9. Required lifecycle behavior

### 9.1. Baseline operation

One domain function handles initial sync, webhook, scheduled reconciliation and manual refresh:

```text
ensureProductBaseline(storeId, productGid)
  read complete Shopify snapshot outside transaction
  begin transaction and product advisory/row lock
  upsert product identity
  if v0 exists: update live catalog status only; return existing v0
  else:
    insert immutable snapshot
    insert v0 source=BASELINE
    set current_version_id and current_observed_snapshot_id
    append audit event
  commit
```

The transaction rechecks existence after acquiring the lock. Network calls never occur while holding the database transaction.

### 9.2. Draft creation

- Resolve current committed version and latest live/observed snapshot before enqueue.
- Persist the base link beside the job.
- SEO Content generation still receives only `images`, `niche`, `storeProfile`; versioning metadata stays operational.
- Revision/regeneration creates a new job/revision link but keeps current committed version unchanged.
- An unresolved possibly-written publish operation blocks a new draft for the same product.

### 9.3. Publish operation

The existing operation states remain valid internally:

```text
QUEUED → CHECKING → WRITING → SUCCEEDED
                       ├─ UNCERTAIN → read-back only
                       └─ BLOCKED
```

Expose a benchmark-facing result mapping:

| Internal result | Public lifecycle status |
| --- | --- |
| Approved but not claimed | `PENDING` |
| Source/review/base checks | `APPLYING_CHECKS` |
| Remote write started | `APPLYING` |
| Read-back in progress | `VERIFYING` |
| Exact read-back + version commit | `SUCCEEDED` |
| Intended content equals live | `NO_CHANGE` |
| Some field differs after possible write | `PARTIAL_APPLY` or `RECONCILIATION_REQUIRED` with per-field evidence |
| Remote result unknown | `RECONCILIATION_REQUIRED` |
| Stale base/hash/source | `CONTENT_CONFLICT` |

Before write:

1. Revalidate approved Review fingerprint and actor permission.
2. Load the job's draft-base version/snapshot/hash.
3. Read a full live Shopify snapshot outside SQL transaction.
4. Reacquire operation/product fence and compare canonical hash.
5. If the live hash differs from the draft base, block without writing.
6. Freeze the actual before snapshot.
7. If selected approved fields already equal live fields, record `NO_CHANGE` and finish without version allocation.
8. Freeze target version as one above the reconciled authoritative local/remote baseline.

After write:

1. Inspect GraphQL and `userErrors`.
2. Read back every intended writable field, including each Media GID alt and version metafield.
3. If exact, commit after snapshot and `vN+1` once.
4. If not exact or unknown, retain write intent and require read-back reconciliation; never resend blindly.
5. Set `applied_at` when the verified Shopify mutation is committed.
6. Set `public_effective_at` only when the configured public-visibility policy is satisfied.
7. Emit an idempotent lifecycle event for later tracking jobs.

### 9.4. External drift

During reconciliation:

- Compare live canonical hash with `current_observed_snapshot_id` and committed version snapshot.
- If different and no matching FFP publish operation explains it, insert a new observed snapshot and external-change row.
- Keep current product SEO version number unchanged.
- Mark the current version interval dirty from `observed_at` until resolved by a verified publish or owner annotation.
- Never infer the external actor.

### 9.5. Rollback

Rollback is a new approved draft/publish operation:

1. Select an immutable historical version snapshot.
2. Read current live snapshot.
3. Produce an allowlisted diff preview.
4. Record a rollback draft based on the current version/hash and referencing the historical version.
5. Require normal approval and publish fencing.
6. On exact read-back, create the next number with `source=ROLLBACK` and `restored_from_version_id`.

No direct database pointer change, version deletion or remote version decrement is permitted.

---

## 10. Public contracts for later workstreams

Routes may follow the current `/api/seo-agent` namespace or the parent specification's store-oriented namespace. The lead freezes one convention before Agent 4 starts.

Required versioning APIs:

```text
GET  store-scoped product lifecycle/current version
GET  store-scoped paginated version history
GET  diff between two version/snapshot IDs
GET  publish operation/job status
POST ensure baseline/sync request with authorization
POST approve existing draft through the current Review boundary
POST apply approved draft with idempotency key
POST request read-back reconciliation
POST create rollback draft; never direct rollback publish
```

Minimum version DTO:

```ts
interface ProductSeoVersionDto {
  readonly id: string;
  readonly storeId: string;
  readonly productGid: string;
  readonly versionNumber: number;
  readonly source: "BASELINE" | "AUTO_SEO" | "ROLLBACK" | "IMPORTED";
  readonly snapshotId: string;
  readonly beforeSnapshotId: string | null;
  readonly predecessorVersionId: string | null;
  readonly restoredFromVersionId: string | null;
  readonly appliedAt: string | null;
  readonly publicEffectiveAt: string | null;
  readonly hasExternalChanges: boolean;
  readonly provenance: {
    readonly jobId: string | null;
    readonly batchId: string | null;
    readonly modelId: string | null;
    readonly pipelineVersion: string | null;
    readonly storeProfileVersion: string | null;
  };
}
```

Future GSC/GA4/benchmark work must receive:

- Stable store/product IDs.
- URL/canonical validity intervals.
- Version and predecessor IDs.
- `applied_at` and nullable `public_effective_at`.
- External-change/dirty intervals.
- Shopify publication/archive/deletion state.
- Immutable snapshot IDs and schema/field-set versions.
- Idempotent events: baseline created, version committed, public effective, external drift, reconciliation required.

No GSC, GA4 or recommendation payload may become a fourth SEO Content generation input.

---

## 11. Team-agent model

### 11.1. Coordination model

- One lead owns the integration branch and all shared conflict files.
- Agents work in isolated branches/worktrees when the environment supports it.
- If Codex collaboration agents share one working directory, they work in waves with disjoint exact file scopes and never switch branches independently.
- Maximum parallel active agents for this project is four including the lead; the plan therefore uses staged waves.
- Every agent task follows the repository's six-part protocol: ownership, branch, behavior/acceptance, allowed contract changes, required commands and forbidden files.
- Every agent makes a focused commit and hands off using the format in `AGENTS.md`.
- The lead reviews module boundaries and integrates; agents never merge their own branch to `main`.

### 11.2. Dependency waves

```text
Phase 0 — Lead freezes decisions/contracts
        │
        ├───────────────┐
        ▼               ▼
Wave A: Agent 1     Wave A: Agent 2
Persistence core    Shopify snapshot reader/design fixture
        └───────┬───────┘
                ▼
Wave B: Agent 3
Publish/version/no-change/reconcile/rollback
                ▼
Wave C: Agent 4
Version API + minimal existing Review integration
                ▼
Wave D: Agent 5
Independent QA, migration/cutover drill and evidence
                ▼
Lead final regression, self-review and handoff
```

### 11.3. Shared conflict files

Only the lead may edit these unless ownership is temporarily and explicitly transferred to one named agent:

- `gateway/custom-gpt-seo/postgres-database.ts`
- `gateway/server.ts`
- `src/app/routes/AppRoutes.tsx`
- Root configuration, `package.json`, lockfile and `.env.example`
- Any new cross-boundary shared contract

The lead applies small composition patches only after the owning agent's public API is stable.

---

## 12. Agent task briefs

### Agent 0 — Versioning Lead / Integrator

**Branch:** `feature/gateway-add-seo-versioning`
**Ownership:** contracts, integration patches, feature/cutover policy, final review and verification.

Responsibilities:

- Freeze Phase 0 decisions and write the compatibility/gap record.
- Establish the integration base containing SEO Content V2.
- Define public domain interfaces before parallel implementation.
- Own all shared conflict files listed above.
- Decide whether transport DTOs live in `src/modules/seo-versioning` or an existing public module.
- Integrate agent commits in dependency order.
- Verify that no second version allocator or browser Shopify write remains for converted stores.
- Run full regression, PostgreSQL QA, MCP boundary QA and Chrome QA.

Required acceptance:

- No ownership overlap remains unresolved.
- Public imports use module entry points.
- No production deployment/store enablement/write occurs.
- Final worktree is clean with focused commits.

Forbidden without renewed user authority:

- Production database migration.
- Enabling versioning WRITE for a real store.
- Approving or publishing a real product.
- Merging into `main` or force-pushing.

### Agent 1 — Persistence and domain model

**Branch:** `feature/gateway-add-seo-version-schema`
**May change:**

- New files under `gateway/seo-versioning/` for domain types, schema, migrations and repository.
- New `gateway/__tests__/seo-version-*.test.ts` persistence tests.
- No integration-file edit unless the lead grants one exact file temporarily.

Deliverables:

- Numbered additive migration and ledger.
- Product registry, immutable snapshots, versions, draft bases, URL history, external changes and audit records.
- Canonical uniqueness/store isolation constraints.
- Transactional `ensureProductBaseline` repository operation.
- Exactly-once version commit primitive that can be called by publisher integration.
- Read APIs for current version, history and snapshots.

Required focused tests:

- Migration reruns safely.
- Exactly one concurrent `v0`.
- Unique version number per store/product.
- Snapshot/version immutability.
- Store isolation.
- Version commit replay returns the original receipt.
- Deleted/archived products keep history.

Must not change:

- Shopify transport/operations.
- Publish worker behavior.
- Browser/UI/MCP.
- SEO Content generation.

### Agent 2 — Shopify snapshot reader, canonical hash and baseline sync

**Branch:** `feature/gateway-create-seo-baselines`
**May change:**

- New snapshot/baseline services under `gateway/seo-versioning/` after Agent 1 freezes interfaces.
- Exact Shopify read operation/query files assigned by the lead.
- New focused Gateway tests and fixtures.

Deliverables:

- Complete product snapshot reader with media pagination.
- Deterministic snapshot builder/hash V1.
- `ensureProductBaseline` application service used by catalog discovery, refresh and future webhook/reconciliation callers.
- Product status and URL/canonical observation.
- External-drift detector that inserts, never mutates, observed snapshots.
- Dry-run catalog report for pilot backfill.

Required focused tests:

- Multi-page media read obtains all images and maps alt by Media GID.
- Duplicate sync/webhook/manual refresh returns the same v0.
- Two workers produce one v0.
- Null/empty/order canonicalization behavior is stable.
- Handle/URL/context changes do not become unauthorized writes.
- External drift keeps the committed snapshot unchanged.
- Shopify GraphQL errors/`userErrors` fail closed.

Must not change:

- Publish repository/schema after Agent 1 handoff.
- Review approval UI.
- MCP worker contract.
- GSC/GA4/performance modules.

### Agent 3 — Draft base, publish integration, no-change and rollback

**Branch:** `feature/gateway-commit-seo-versions`
**May change:**

- `gateway/seo-worker/publish-schema.ts`
- `gateway/seo-worker/publish-repository.ts`
- `gateway/seo-worker/publish-worker.ts`
- `gateway/seo-worker/publish-transport.ts`
- Assigned revision/draft integration files.
- `gateway/__tests__/seo-publish*.test.ts`, revision tests and new version-lifecycle tests.

Deliverables:

- Draft base link to authoritative version/snapshot/hash.
- Pre-write canonical content conflict check.
- `NO_CHANGE` without Shopify write or version row.
- Frozen before snapshot and full read-back after snapshot.
- Exactly-one authoritative `vN+1` commit linked to current durable receipt.
- Per-field verification evidence for partial/reconciliation outcomes.
- DB-recovery path after remote success.
- Rollback-draft service that still requires approval/publish.
- Disable or route the old browser/orchestrator allocator for converted stores.

Required focused tests:

- Generate/regenerate does not increment version.
- No-change performs zero writes and creates zero versions.
- Stale base hash blocks before write.
- HTTP 200 plus errors is not success.
- Partial image-alt result does not commit success.
- Lost write response performs read-back only and commits one version.
- DB failure after remote success recovers to one version.
- Concurrent publishers cannot allocate duplicate/skip versions silently.
- Rollback from v0 while current is v1 creates v2 with correct reference.
- Existing publish and revision regression tests remain green.

Must not change:

- Full Shopify catalog sync/webhook infrastructure.
- Dashboard/GSC/GA4 code.
- SEO Content semantic input.
- App routing.

### Agent 4 — Version API and minimal Review adapter

**Branch:** `feature/gateway-expose-seo-version-history`
**May change:**

- New Gateway versioning handler/router files.
- New public browser client/types in the module selected by the lead.
- Minimal existing SEO Review components necessary to display lifecycle/history/diff.
- Associated API/client/UI tests.

Deliverables:

- Store-scoped lifecycle, history, snapshot diff, operation status and rollback-draft endpoints.
- Server-side action permissions and disabled reasons.
- Paginated immutable history.
- Field/media diff by Media GID.
- Minimal UI proof for v0 → draft → v1, external drift, reconciliation and rollback reference.
- Loading, empty, stale, partial, error and success states.

This agent does not build the future SEO Benchmark dashboard.

Required focused tests:

- Store ID tampering cannot read another store's version/snapshot.
- Unknown product/version returns safe errors.
- Diff is deterministic and treats missing/null/empty correctly.
- UI does not calculate or invent a version.
- UI never sends Shopify credentials or directly calls Shopify.
- HTML snapshot rendering is sanitized.

Must not change:

- Domain allocation rules.
- Publish worker/transport.
- GSC/GA4 modules.
- Root route composition unless the lead grants the exact file.

### Agent 5 — Independent QA and rollout evidence

**Branch:** `test/gateway-cover-seo-version-lifecycle`
**May change:** test fixtures, integration/E2E tests and a versioning runbook assigned by the lead.

Responsibilities:

- Build a traceability matrix from parent benchmark section 20.1 and relevant 20.5 requirements to tests/evidence.
- Execute fault injection, PostgreSQL concurrency/restart and migration/cutover drills.
- Exercise MCP draft-only boundaries.
- Perform Chrome QA against local/staging pilot data.
- Route failures back to the owning implementation agent; do not weaken assertions.

Must not:

- Patch business code to make tests pass without lead reassignment.
- Skip a relevant acceptance test because an environment is inconvenient.
- Use production DB or publish a real product without explicit authorization.
- Approve, sync or rollback during a READ-only QA phase.

---

## 13. Implementation phases and gates

### Phase 0 — Contract freeze and compatibility matrix

Tasks:

1. Re-read parent benchmark sections 1, 4, 5, 7–9, 13, 15–17, 19–23.
2. Freeze decisions in section 6 of this plan.
3. Inventory every version source/allocator and every browser/backend publish path.
4. Record the cutover rule for existing `seo_publish_versions` and remote metafields.
5. Define snapshot/hash/field-set schema and DTOs.
6. Define feature flags and actor permissions.
7. Select pilot and obtain separate authorization level: READ-only, staging WRITE or real pilot WRITE.

Gate P0:

- No unresolved source-of-truth decision.
- No ambiguous ownership of shared files.
- No planned second publisher/version allocator.
- Versioning work starts from one common base commit.

### Phase 1 — Additive schema and core repository

Tasks:

1. Add numbered migration/ledger.
2. Create product, snapshot, version, draft-base, URL-history, drift and audit schema.
3. Add constraints/indexes/foreign keys.
4. Implement immutable repository reads/writes.
5. Implement baseline and version-commit transaction primitives.
6. Add PGlite unit and PostgreSQL integration tests.

Gate P1:

- Fresh DB and upgrade DB both initialize.
- Migration rerun is idempotent.
- Concurrent v0 and version commit tests pass on real PostgreSQL.
- Rollback rehearsal on isolated staging backup succeeds.

### Phase 2 — Shopify snapshot and baseline lifecycle

Tasks:

1. Implement paginated snapshot reader.
2. Implement canonical snapshot/hash algorithm V1.
3. Implement `ensureProductBaseline` application service.
4. Add dry-run catalog discovery/backfill with progress/checkpointing.
5. Connect existing refresh path first; webhook/scheduler adapters call the same service.
6. Implement URL observation and external drift detection.

Gate P2:

- Old and newly observed products create one v0.
- Refresh does not create another version.
- Media pagination evidence is complete for fixtures and pilot sample.
- No Shopify write occurs.
- READ feature can be disabled without breaking existing Auto-SEO/feed behavior.

### Phase 3 — Draft fencing and durable publish integration

Tasks:

1. Attach base version/snapshot/hash at enqueue/revision creation.
2. Add canonical pre-write conflict check.
3. Add no-change terminal receipt.
4. Freeze before snapshot and expected after snapshot.
5. Extend read-back verification to complete intended fields.
6. Commit authoritative version and publish receipt atomically.
7. Add partial/uncertain per-field reconciliation evidence.
8. Remove/disable parallel browser version allocation for converted stores.
9. Implement rollback draft creation.

Gate P3:

- All fault-injection tests pass.
- Draft/regenerate does not increment version.
- Full verified publish increments exactly once.
- No-change, partial, uncertain and conflict create no successful version.
- MCP surface still contains no approval/publish tool.

### Phase 4 — API and minimal Review proof

Tasks:

1. Expose lifecycle/current version/history/diff.
2. Expose safe publish/reconcile/rollback-draft status and disabled reasons.
3. Add typed browser client through a module public entry point.
4. Add minimal Review timeline/diff badges without building the benchmark dashboard.
5. Ensure source/proposed/version snapshots remain visually distinguishable.

Gate P4:

- Store authorization tests pass.
- History/diff are server authoritative.
- UI handles loading/empty/partial/error/stale states.
- No secret or direct Shopify request appears in browser network traffic.

### Phase 5 — Migration, cutover and acceptance

Tasks:

1. Backup database and produce manifest/count/hash.
2. Apply additive migration with all flags OFF.
3. Run READ-only catalog dry-run for the pilot.
4. Backfill v0 in bounded batches; verify counts and sample hashes.
5. Enable version-history READ for pilot.
6. Reconcile/drain all current write-intent operations before WRITE cutover.
7. Run one staging/clone lifecycle v0 → draft → verified v1.
8. Run external edit and rollback-to-new-version scenarios on staging.
9. Run full regression and document any unrelated environment skips.
10. Keep real pilot WRITE disabled until separate approval.

Gate P5:

- All automated/DB/MCP/Chrome gates pass.
- Migration rollback/recovery evidence exists.
- No unresolved operation has write intent.
- Handoff states precisely what was fixture, staging, live READ and live WRITE.

---

## 14. Testing strategy and fix–test–fix loop

### 14.1. Test-first requirement

For every behavior change:

1. Add/update the focused public-behavior test.
2. Confirm the test fails for the intended missing behavior.
3. Implement the smallest scoped change.
4. Re-run the single failure.
5. Re-run the owner suite.
6. Run affected TypeScript typecheck.
7. At code freeze, run all required regression commands.

Do not weaken schemas, accept legacy fallback, use `any`, add ignore directives or remove assertions to obtain green output.

### 14.2. Focused automated matrix

| Area | Required scenarios |
| --- | --- |
| Schema/migration | Fresh install, upgrade, rerun, constraints, isolation, backup restore, feature rollback. |
| Baseline | Existing/new product, duplicate webhook, concurrent workers, refresh, draft/archive/delete, full media pagination. |
| Snapshot/hash | Stable ordering, Media GID mapping, null/empty, HTML line endings, context excluded from writable hash, immutability. |
| Draft | Correct base version/hash, regenerate, superseded job, unresolved publish guard. |
| Publish | Success, no-change, source/content conflict, GraphQL errors, userErrors, missing image, partial alt, lost response, lease expiry. |
| Recovery | Crash before write, after write, before read-back, after read-back/before DB commit, restart/multi-process reconciliation. |
| Concurrency | Two v0 creators, two draft publishers, store isolation, idempotency replay. |
| Drift | External title/SEO/alt change, URL change, unknown actor, immutable committed snapshot, dirty interval. |
| Rollback | Preview, approval, vN+1, restored reference, retry, no direct version decrement. |
| API/security | Store tampering, authorization, pagination, sanitization, safe errors, no secrets. |
| Compatibility | Existing queue, worker, Review, Auto-SEO, mock runtime and disabled-feature behavior. |

Suggested focused commands, adjusted to actual filenames:

```bash
npx tsx --test gateway/__tests__/seo-version-*.test.ts
npx tsx --test gateway/__tests__/seo-publish*.test.ts
npx tsx --test gateway/__tests__/seo-revision*.test.ts
npx tsx --test gateway/__tests__/seo-worker-mcp.test.ts
```

Required final commands:

```bash
npm test
npm run typecheck
npm run build
npm run build:mock
```

No pass may be claimed without fresh output from the final diff.

### 14.3. Failure routing

For every failure, preserve command/test/error evidence and classify it:

- Domain/schema → Agent 1.
- Shopify snapshot/baseline/drift → Agent 2.
- Draft/publish/reconcile/rollback → Agent 3.
- API/minimal Review UI → Agent 4.
- Environment/test harness → Agent 5 and lead.

The owning agent fixes the smallest scope, then the lead repeats the affected gate. After any post-QA code change, repeat full regression and the affected live/visual scenario.

---

## 15. PostgreSQL QA

Use a dedicated local/test PostgreSQL database. Never point destructive or fault-injection tests at the VPS production database.

Required checks:

1. Apply migrations twice to a fresh isolated schema.
2. Upgrade a fixture representing the pre-versioning publish schema.
3. Verify unique/FK/check/immutability constraints.
4. Run two concurrent `ensureProductBaseline` calls; assert one v0/snapshot.
5. Run two concurrent publish enqueues; assert one active owner.
6. Simulate process death at every publish boundary.
7. Restart with a fresh process and reconcile exactly one version.
8. Verify `NO_CHANGE` performs zero Shopify writes and creates zero version rows.
9. Verify store A cannot read/write store B history.
10. Restore backup into a separate schema and compare product/version/snapshot counts and hashes.
11. Confirm feature rollback leaves all records readable and disables new writes.

Relevant environment variables may include the existing `SEO_QUEUE_TEST_DATABASE_URL`; new test variables must be server-only and documented in `.env.example` without secrets.

---

## 16. MCP QA

The canonical MCP worker remains draft-only.

Required assertions:

- `job_get_context` remains SEO Content V2-only and does not expose version snapshots/performance as semantic generation input.
- Claim → images → analysis → research → keywords → submission reaches Review without creating a committed product version.
- Revision/regeneration creates a new draft lineage and base link but leaves current version unchanged.
- Stale draft base is blocked only in operator publish flow.
- Same MCP request ID is idempotent; a new request ID creates a new draft/revision, not a version.
- MCP tools expose no approve, apply, reconcile, rollback-publish or arbitrary SQL capability.
- After an operator/staging apply, MCP may read safe status/history but cannot confirm or alter a version.

Live QA stops at `REVIEW_READY` unless the user separately authorizes a named staging/clone publish.

---

## 17. Chrome visual QA

Use the user-specified Chrome surface after automated tests pass. Use Jeminise and a clone/test product unless a real product is explicitly approved.

### 17.1. READ-only/baseline checks

- Store selector shows Jeminise.
- Catalog product loads from Shopify GraphQL.
- Baseline creation/refresh shows v0 exactly once.
- Reload preserves v0 and history.
- Draft/archived/unpublished states are clear and not treated as publicly benchmarkable.
- Browser console contains no change-caused errors.

### 17.2. Draft checks

- Starting Auto-SEO creates one draft/job.
- v0 remains v0 after generation and regeneration.
- Review shows proposed content separately from immutable baseline/source.
- Version number is read from backend, never calculated by UI.

### 17.3. Controlled staging WRITE checks

Only after explicit WRITE authorization:

- Approve and apply one test/clone product.
- Observe pending/applying/verifying states and reload safely.
- Verified success changes v0 → v1 once.
- Opening two tabs from the same base lets the first succeed and blocks the second with a conflict.
- No-change shows a no-op result and stays on the same version.
- Partial/timeout fixture shows reconciliation required, never successful v2.
- External Shopify edit creates drift without mutating v1 snapshot.
- Rollback preview of v0, after approval/apply, creates v2 with rollback reference.

### 17.4. Network/safety checks

- Requests are store-scoped and carry idempotency keys where required.
- Browser never calls Shopify Admin directly.
- No bearer token, refresh token, DB URL or Shopify credential appears in UI/network payloads.
- Disable per-store WRITE/global publish and verify write actions become unavailable without breaking read/feed/Auto-SEO.

Capture screenshots for v0, draft-still-v0, verified v1, conflict/reconciliation and rollback-v2 when those scenarios are authorized. Record URL, store, product/job/operation IDs, timestamp and whether data is fixture/staging/live.

---

## 18. Migration and cutover runbook

### 18.1. Preflight

1. Confirm the target deployment contains SEO Content V2.
2. Record current branch/commit and schema version.
3. Backup PostgreSQL and verify restore into an isolated database.
4. Inventory `seo_publish_operations`, `seo_publish_versions`, `gpt_sync`, Review state and worker reservations.
5. Inventory remote `custom.seo_version` for the bounded pilot catalog.
6. Report mismatched/malformed/missing remote versions; do not guess corrections.
7. Drain or reconcile every operation with possible write intent.
8. Keep versioning READ/WRITE flags OFF.

### 18.2. Additive deployment

1. Deploy schema/application with flags OFF.
2. Run migration verification and readiness checks.
3. Run catalog dry-run; compare product/media counts.
4. Enable READ baseline backfill for the pilot in bounded resumable batches.
5. Sample-check snapshot payloads/hashes and exactly one v0.
6. Enable version-history API/UI READ.
7. Observe logs/locks/query counts before any WRITE.

### 18.3. WRITE cutover

1. Reconfirm operator/Publisher identity and named pilot product.
2. Enable per-store versioning WRITE.
3. Enable the existing global backend publish flag only if all current gates pass.
4. Perform one controlled v0 → draft → approve → verified v1 canary.
5. Read Shopify again and compare all intended fields plus mirror version.
6. Verify one operation receipt, one authoritative v1 and unchanged v0 snapshot.
7. Expand only in small batches after the observation window defined by the lead.

### 18.4. Technical rollback

- Turn off per-store WRITE, then the global publish worker.
- Stop new enqueue/apply actions.
- Continue read-back reconciliation for operations that may already have written; do not resend blindly.
- Roll back application release if needed while preserving additive tables/history.
- Restore database only through the verified backup process and explicit incident approval.
- To revert Shopify content, use the business rollback workflow that creates a new version; never edit/delete historical rows.

---

## 19. Acceptance traceability checklist

### 19.1. Parent benchmark section 20.1

- [ ] Existing product first sync creates exactly one v0.
- [ ] Product discovered later also creates exactly one v0.
- [ ] Duplicate sync/webhook does not reset or duplicate version.
- [ ] Media pagination captures all images and maps alt by Media GID.
- [ ] Generate/regenerate does not change current version.
- [ ] Verified apply increments exactly once.
- [ ] No-change creates no empty version.
- [ ] GraphQL HTTP 200 plus `userErrors` is not success.
- [ ] Timeout, partial alt and DB failure reconcile safely.
- [ ] Concurrent apply cannot silently overwrite.
- [ ] External edit creates drift and does not mutate old snapshot.
- [ ] Draft/unpublished product does not start public benchmark timing.
- [ ] Delete/archive retains history.
- [ ] Rollback creates a new version and source reference.

### 19.2. Security and regression

- [ ] Store/property switching cannot leak product/version/cache/action state.
- [ ] Store authorization blocks URL/request tampering.
- [ ] No secret is stored in snapshots, logs, exports or frontend payloads.
- [ ] Snapshot HTML cannot execute scripts in UI.
- [ ] Disabled flags preserve legacy feed/Auto-SEO read behavior.
- [ ] No N+1 Shopify call is introduced for version-list rows.
- [ ] Load/concurrency target and measured DB/API counts are recorded.
- [ ] Backup restore, migration rollback and crash recovery are tested before production.

### 19.3. Evidence classification

The final report must label every result as one of:

- Deterministic unit fixture.
- PGlite integration.
- Real local PostgreSQL integration.
- Local/staging Shopify READ.
- Controlled staging/clone WRITE.
- Production live observation.

Fixture or READ-only evidence must never be described as a successful production publish.

---

## 20. Handoff contract to GSC/GA4 and dashboard teams

Versioning handoff is accepted by later teams only when they can consume stable APIs/events for:

- `(store_id, shopify_product_gid)` product identity.
- Current version and immutable version history.
- Content diff and snapshot schema/field-set versions.
- URL/canonical validity intervals.
- `applied_at` and nullable `public_effective_at`.
- Product public/archive/delete state.
- External-change/dirty intervals.
- Version provenance: source, job/batch, prompt/model/pipeline/store-profile versions.
- Audit and operation status.

The later data team owns benchmark windows, metric formulas, GSC/GA4 facts, eligibility and recommendation rules. The later UI team owns the complete benchmark dashboard. Neither team may recalculate or invent product SEO versions independently.

---

## 21. Final lead checklist

Before implementation:

- [ ] Base commit contains SEO Content V2.
- [ ] Phase 0 decisions are frozen.
- [ ] Agent ownership and exact file scopes are assigned.
- [ ] Pilot and authorization level are recorded.
- [ ] Backup/test PostgreSQL environment is available.

Before handoff:

- [ ] One authoritative version allocator remains.
- [ ] v0/snapshot/version/draft-base/drift/rollback invariants pass.
- [ ] Existing durable publish safety is preserved.
- [ ] Public module boundaries and strict TypeScript rules pass review.
- [ ] Focused, PostgreSQL, MCP and Chrome QA pass.
- [ ] `npm test`, `npm run typecheck`, `npm run build`, `npm run build:mock` have fresh passing output.
- [ ] Migration/cutover/rollback evidence is attached.
- [ ] No production migration/write occurred without explicit authorization.
- [ ] Agent handoffs list changed files, verification, contracts and remaining risks.

The Versioning workstream is technically complete when a product can safely move through:

```text
new/first observation → v0 → draft remains v0 → approved verified apply → v1
→ external drift is preserved as drift → rollback draft → approved verified v2
```

with immutable history, exactly-once version commits, safe reconciliation and stable contracts for the future GSC/GA4 and dashboard workstreams.
