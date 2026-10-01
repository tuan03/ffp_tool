# Auto SEO Smart Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator select the next 10, 20, 50, or 100 products that need SEO, while authoritatively skipping unchanged or duplicate work before dispatch.

**Architecture:** Add a cheap `updatedAt`-based eligibility preview for the loaded Shopify list, then hydrate only the selected batch and compare a stable gateway-computed SEO input hash inside the existing backup transaction. Persist the SEO hash separately from the full snapshot checksum, return accepted/skipped outcomes, and keep the explicit Run button as the only trigger.

**Tech Stack:** React, TypeScript strict mode, Vite, Tailwind CSS, Node HTTP gateway, Node SQLite, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-01-auto-seo-smart-batch-design.md`

## Global Constraints

- Implement on the existing `rua` branch; do not create another branch.
- Do not push unless the user explicitly requests it.
- Preserve existing Auto SEO, Queue, Review, store scoping, mock mode, and provider behavior.
- Do not publish to Shopify or add any automatic publishing path.
- Do not fetch full product details for every product during eligibility preview.
- Default batch size is `50`; allowed values are exactly `10`, `20`, `50`, and `100`.
- Preserve `snapshot_sha256` as the full snapshot integrity checksum; use a distinct `seo_input_sha256` for eligibility.
- Keep all API additions backward compatible and validate untrusted gateway inputs.
- Add no dependency and no new application route.

## Review Focus

- Missing or invalid Shopify `updatedAt`: classify conservatively as needing an authoritative check instead of incorrectly declaring the product current; cover in Task 2.
- More than 1,000 products and malformed/duplicate product summaries: accept up to 5,000 valid summaries and reject invalid or duplicate IDs deterministically; cover in Task 2.
- A stale eligibility response arriving after the operator switches stores: ignore it and keep the new store's state empty; cover in Task 5.
- A Shopify update that changes only excluded volatile fields: authoritative hash stays equal and the run skips it as unchanged; cover in Task 1 and Task 3.
- Two simultaneous submissions of the same store/product/hash: only one dispatch occurs and the other returns `ACTIVE_DUPLICATE`; cover in Task 3.

---

## File Structure

- Create `gateway/auto-seo-input-hash.ts`: normalize SEO-relevant Shopify source fields and calculate the stable hash.
- Create `gateway/auto-seo-eligibility.ts`: validate preview requests, query backup/review/queue state, classify products, and perform authoritative acceptance checks.
- Create `gateway/__tests__/auto-seo-smart-batch.test.ts`: gateway hash, migration, classification, deduplication, and concurrency coverage.
- Create `src/modules/auto-seo/ui/smart-batch.ts`: pure eligibility filtering, ranking, and batch selection.
- Create `src/modules/auto-seo/__tests__/smart-batch.test.ts`: pure UI selection behavior.
- Modify `gateway/auto-seo-db.ts`: additive hash migration and lookup index.
- Modify `gateway/auto-seo-handler.ts`: eligibility handler and accepted/skipped run behavior.
- Modify `gateway/server.ts` and `gateway/vite-plugin.ts`: route `/api/auto-seo/eligibility` through the same auth/mock boundaries as `/api/auto-seo/run`.
- Modify `gateway/custom-gpt-seo/queue.ts`: expose a focused store/source/identity lookup used to detect identical active work.
- Modify `src/modules/auto-seo/types.ts` and `src/modules/auto-seo/index.ts`: public eligibility and run-result contracts.
- Modify `src/modules/auto-seo/mocks/runner.ts`: mock eligibility and accepted/skipped parity.
- Modify `src/modules/orchestrator/auto-seo-module-api-client.ts`: call and validate the eligibility API and expanded run response.
- Modify `src/modules/orchestrator/__tests__/auto-seo-module-api-client.test.ts`: real-client transport tests.
- Modify `src/modules/auto-seo/ui/auto-seo-session.ts`: persist batch size/filter only; keep eligibility response transient in the page.
- Modify `src/modules/auto-seo/ui/components/AutoSeoToolbar.tsx`: batch size, smart-select action, state counts, and loading/error states.
- Modify `src/modules/auto-seo/ui/components/ProductSelectionTable.tsx` and `product-filter.ts`: eligibility filter and state badge.
- Modify `src/modules/auto-seo/ui/AutoSeoPage.tsx`: load eligibility, prevent stale-store updates, smart-select, and run summaries.
- Modify focused Auto SEO UI/session tests to pin the integrated behavior.

### Task 1: Stable SEO Input Hash and Database Migration

**Files:**
- Create: `gateway/auto-seo-input-hash.ts`
- Modify: `gateway/auto-seo-db.ts`
- Test: `gateway/__tests__/auto-seo-smart-batch.test.ts`

**Interfaces:**
- Consumes: `AutoSeoProductPayload`, `canonicalizeJson(value)`, and `calculateSha256(value)`.
- Produces: `normalizeAutoSeoHashInput(product: AutoSeoProductPayload): unknown` and `calculateAutoSeoInputHash(product: AutoSeoProductPayload): string`; nullable database column `seo_input_sha256`.

- [ ] **Step 1: Write failing hash tests**

Add tests named:

- `SEO input hash is stable for equivalent tag, image, and variant ordering`;
- `SEO input hash changes when title, description, SEO metadata, product facts, or image content changes`;
- `SEO input hash ignores createdAt, updatedAt, storeId, pagination flags, and inventoryQuantity`.

The normalizer must include trimmed `id`, `title`, `handle`, `description`, `descriptionHtml`, `status`, `vendor`, `productType`, `onlineStoreUrl`, SEO title/description, sorted unique trimmed tags, normalized featured image/images, and variants without inventory quantity. Sort images by `(position, id, url)` and variants by ID before canonicalization.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --import tsx --test gateway/__tests__/auto-seo-smart-batch.test.ts`  
Expected: FAIL because the hash helper does not exist.

- [ ] **Step 3: Implement the hash helper**

Implement the two exported functions with no mutation of input values. Use the repository's canonical JSON and SHA-256 helpers; do not add a hashing dependency.

- [ ] **Step 4: Write failing migration tests**

Assert that `initAutoSeoDbSchema(db)`:

- adds `seo_input_sha256 TEXT` to a newly created database;
- adds it safely to a legacy table that lacks the column;
- creates `idx_auto_seo_store_product_input` over `(store_id, product_id, seo_input_sha256, downstream_status)`;
- remains idempotent when called twice.

- [ ] **Step 5: Implement the additive migration**

Update `initAutoSeoDbSchema` and both insert SQL statements so newly accepted backups can store `seo_input_sha256`, while legacy callers may pass `NULL`. Extend `AutoSeoProductBackupRecord` with `seoInputSha256?: string | null`.

- [ ] **Step 6: Run focused tests**

Run: `node --import tsx --test gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-backup.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add gateway/auto-seo-input-hash.ts gateway/auto-seo-db.ts gateway/__tests__/auto-seo-smart-batch.test.ts
git commit -m "feature(gateway): add auto seo input hashes"
```

### Task 2: Eligibility Preview API and Client Contract

**Files:**
- Create: `gateway/auto-seo-eligibility.ts`
- Modify: `gateway/auto-seo-handler.ts`
- Modify: `gateway/server.ts`
- Modify: `gateway/vite-plugin.ts`
- Modify: `src/modules/auto-seo/types.ts`
- Modify: `src/modules/auto-seo/index.ts`
- Modify: `src/modules/auto-seo/mocks/runner.ts`
- Modify: `src/modules/orchestrator/auto-seo-module-api-client.ts`
- Test: `gateway/__tests__/auto-seo-smart-batch.test.ts`
- Test: `gateway/__tests__/auto-seo-mock-guard.test.ts`
- Test: `src/modules/orchestrator/__tests__/auto-seo-module-api-client.test.ts`
- Test: `src/modules/auto-seo/__tests__/auto-seo-mock-isolation.test.ts`

**Interfaces:**
- Consumes: backup rows keyed by `(store_id, product_id)` and existing Queue/Review state.
- Produces:
  - `AutoSeoEligibilityState = "never_processed" | "changed" | "current" | "active" | "retry"`;
  - `AutoSeoEligibilityRequest { storeId; products: readonly { productId; updatedAt? }[] }`;
  - `AutoSeoEligibilityItem { productId; state; reason; lastSuccessfulShopifyUpdatedAt? }`;
  - `AutoSeoEligibilityResponse { items; counts }`;
  - `AutoSeoClient.getProductEligibility(request): Promise<AutoSeoEligibilityResponse>`;
  - POST `/api/auto-seo/eligibility`.

- [ ] **Step 1: Add failing gateway classification tests**

Cover never processed, latest successful dispatch, failed-only history, newer Shopify timestamp, equal/older timestamp, a legacy successful row with no hash, identical active Queue work, pending non-deleted Review work, store isolation, missing/invalid timestamp, duplicate product IDs, empty store ID, and 5,001 summaries. Missing/invalid timestamps and legacy rows must return `changed` with a reason requiring authoritative verification; the maximum accepted list is 5,000.

- [ ] **Step 2: Run gateway tests and verify failure**

Run: `node --import tsx --test gateway/__tests__/auto-seo-smart-batch.test.ts`  
Expected: FAIL because eligibility validation/classification is absent.

- [ ] **Step 3: Implement eligibility validation and classification**

In `gateway/auto-seo-eligibility.ts`, add:

- `validateAutoSeoEligibilityRequest(body: unknown): AutoSeoEligibilityRequest`;
- `getAutoSeoEligibility(db: DatabaseSync, request: AutoSeoEligibilityRequest, queue: CustomGptQueue): AutoSeoEligibilityResponse`.

Use batched SQL rather than one query per product. Consider only `downstream_status = 'SENT'` a successful baseline. Treat non-deleted pending Review work and nonterminal queue work as active only when it corresponds to the current known revision; do not let another store's rows affect the result.

- [ ] **Step 4: Add failing HTTP route tests**

Assert POST success envelope, 400 validation envelope, 401 auth behavior, 405 for non-POST, request-size protection, and the same mock-mode 403 guard as `/api/auto-seo/run`.

- [ ] **Step 5: Route and handle the eligibility endpoint**

Add `handleAutoSeoEligibilityHttpRequest(req, res, options)` beside the run handler and register the exact path in both production server and Vite gateway plugin. Reuse existing auth, body-limit, safe-error, and mock-mode conventions.

- [ ] **Step 6: Add failing module/client tests**

Assert public types are used by `AutoSeoClient`, the real client posts the exact request to `/api/auto-seo/eligibility`, rejects malformed success payloads with `AUTO_SEO_LOAD_FAILED`, and the mock client returns deterministic store-scoped states without calling `fetch`.

- [ ] **Step 7: Implement public contract, real client, and mock parity**

Export the new types through `src/modules/auto-seo/index.ts`. Implement `getProductEligibility` in both clients. Clone mock return values and keep mock state independent per store.

- [ ] **Step 8: Run focused tests**

Run: `node --import tsx --test gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-mock-guard.test.ts src/modules/orchestrator/__tests__/auto-seo-module-api-client.test.ts src/modules/auto-seo/__tests__/auto-seo-mock-isolation.test.ts`  
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add gateway/auto-seo-eligibility.ts gateway/auto-seo-handler.ts gateway/server.ts gateway/vite-plugin.ts gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-mock-guard.test.ts src/modules/auto-seo/types.ts src/modules/auto-seo/index.ts src/modules/auto-seo/mocks/runner.ts src/modules/orchestrator/auto-seo-module-api-client.ts src/modules/orchestrator/__tests__/auto-seo-module-api-client.test.ts src/modules/auto-seo/__tests__/auto-seo-mock-isolation.test.ts
git commit -m "feature(orchestrator): expose auto seo eligibility"
```

### Task 3: Authoritative Run Filtering and Duplicate Fencing

**Files:**
- Modify: `gateway/auto-seo-eligibility.ts`
- Modify: `gateway/auto-seo-handler.ts`
- Modify: `gateway/auto-seo-db.ts`
- Modify: `gateway/custom-gpt-seo/queue.ts`
- Modify: `src/modules/auto-seo/types.ts`
- Modify: `src/modules/auto-seo/mocks/runner.ts`
- Modify: `src/modules/orchestrator/auto-seo-module-api-client.ts`
- Test: `gateway/__tests__/auto-seo-smart-batch.test.ts`
- Test: `gateway/__tests__/auto-seo-backup.test.ts`
- Test: `gateway/__tests__/custom-gpt-queue.test.ts`
- Test: `src/modules/orchestrator/__tests__/auto-seo-module-api-client.test.ts`

**Interfaces:**
- Consumes: `calculateAutoSeoInputHash(product)`, latest backup state, and focused Queue source lookup.
- Produces:
  - `AutoSeoSkippedProduct { productId; reason: "UNCHANGED" | "ACTIVE_DUPLICATE" }`;
  - additive run fields `acceptedProductIds`, `acceptedCount`, `skippedProducts`, and `skippedCount`;
  - `CustomGptQueue.findLatestSourceJob(storeId, source, sourceIdentity): GptSeoJob | null`.

- [ ] **Step 1: Write failing authoritative filtering tests**

Cover first run accepted, same normalized payload skipped despite a newer `updatedAt`, changed title accepted, failed dispatch retry accepted, mixed accepted/skipped request, same hash active in Queue skipped, changed hash superseding older unapproved Queue work, and no products accepted returning success without calling the SEO runner.

- [ ] **Step 2: Write the concurrency regression test**

Submit two requests for the same store/product/hash against the same SQLite database and a deferred runner. Assert one request accepts and dispatches the product, while the other reports `ACTIVE_DUPLICATE` and does not dispatch it.

- [ ] **Step 3: Run focused gateway tests and verify failure**

Run: `node --import tsx --test gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-backup.test.ts gateway/__tests__/custom-gpt-queue.test.ts`  
Expected: FAIL because authoritative filtering and response fields are absent.

- [ ] **Step 4: Implement focused Queue lookup**

Add `findLatestSourceJob` without exposing raw SQL outside `CustomGptQueue`. Normalize Shopify product IDs exactly as `enqueue` does and return the newest non-cancelled source job for the requested store.

- [ ] **Step 5: Implement atomic acceptance**

Inside the existing `BEGIN IMMEDIATE` backup transaction, calculate each product hash and compare it with rows for the same store/product. Treat matching `NOT_SENT` as `ACTIVE_DUPLICATE`, matching `SENT` as `UNCHANGED`, and `FAILED` as retryable. Insert backups only for accepted products, including `seo_input_sha256`; pass only accepted products to the runner. Preserve full snapshot backup and current rollback/status-update behavior.

- [ ] **Step 6: Return additive run outcomes**

Populate all four new response fields. Keep `backedUpCount` equal to accepted products. If none are accepted, return `downstreamStatus: "SENT"`, do not call the runner, and report every skipped reason.

- [ ] **Step 7: Update real and mock response validation**

Validate the additive fields when present without breaking old server responses. Make mock runs apply the same deterministic hash/dedup behavior for the lifetime of the mock client.

- [ ] **Step 8: Run focused tests**

Run: `node --import tsx --test gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-backup.test.ts gateway/__tests__/custom-gpt-queue.test.ts src/modules/orchestrator/__tests__/auto-seo-module-api-client.test.ts src/modules/auto-seo/__tests__/auto-seo-mock-isolation.test.ts`  
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add gateway/auto-seo-eligibility.ts gateway/auto-seo-handler.ts gateway/auto-seo-db.ts gateway/custom-gpt-seo/queue.ts gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-backup.test.ts gateway/__tests__/custom-gpt-queue.test.ts src/modules/auto-seo/types.ts src/modules/auto-seo/mocks/runner.ts src/modules/orchestrator/auto-seo-module-api-client.ts src/modules/orchestrator/__tests__/auto-seo-module-api-client.test.ts src/modules/auto-seo/__tests__/auto-seo-mock-isolation.test.ts
git commit -m "feature(gateway): skip unchanged auto seo work"
```

### Task 4: Pure Smart-Batch Selection and Session Preferences

**Files:**
- Create: `src/modules/auto-seo/ui/smart-batch.ts`
- Create: `src/modules/auto-seo/__tests__/smart-batch.test.ts`
- Modify: `src/modules/auto-seo/ui/auto-seo-session.ts`
- Modify: `src/modules/auto-seo/__tests__/auto-seo-session.test.ts`

**Interfaces:**
- Consumes: loaded `ShopifyProductForAutoSeoUi[]` and `AutoSeoEligibilityResponse`.
- Produces:
  - `AutoSeoBatchSize = 10 | 20 | 50 | 100`;
  - `AutoSeoEligibilityFilter = "needs_seo" | "all"`;
  - `selectNextAutoSeoBatch(products, eligibilityItems, batchSize): readonly string[]`;
  - persisted session fields `batchSize` and `eligibilityFilter`.

- [ ] **Step 1: Write failing pure selection tests**

Assert priority `never_processed` before `changed`/`retry`, newest valid `updatedAt` first inside a group, stable product-ID tie-breaker, exclusion of `current`/`active`, exact batch cap for all four sizes, no duplicate IDs, and deterministic handling of missing/invalid timestamps.

- [ ] **Step 2: Run selection tests and verify failure**

Run: `node --import tsx --test src/modules/auto-seo/__tests__/smart-batch.test.ts`  
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the pure helper**

Use maps/sets so selection is linear except for sorting eligible candidates. Return a new ID array and never mutate products or eligibility items.

- [ ] **Step 4: Write failing session tests**

Assert defaults `50` and `needs_seo`, valid persistence/restoration, rejection of invalid stored values, and reset to defaults. Eligibility results themselves must not be persisted.

- [ ] **Step 5: Implement session preferences**

Add typed setters `setAutoSeoBatchSize` and `setAutoSeoEligibilityFilter`, include the two values in the existing storage record, and keep backward compatibility with stored v1 sessions that omit them.

- [ ] **Step 6: Run focused tests**

Run: `node --import tsx --test src/modules/auto-seo/__tests__/smart-batch.test.ts src/modules/auto-seo/__tests__/auto-seo-session.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/auto-seo/ui/smart-batch.ts src/modules/auto-seo/ui/auto-seo-session.ts src/modules/auto-seo/__tests__/smart-batch.test.ts src/modules/auto-seo/__tests__/auto-seo-session.test.ts
git commit -m "feature(main): rank auto seo batches"
```

### Task 5: Auto SEO Page and Controls

**Files:**
- Modify: `src/modules/auto-seo/ui/AutoSeoPage.tsx`
- Modify: `src/modules/auto-seo/ui/components/AutoSeoToolbar.tsx`
- Modify: `src/modules/auto-seo/ui/components/ProductSelectionTable.tsx`
- Modify: `src/modules/auto-seo/ui/components/product-filter.ts`
- Modify: `src/modules/auto-seo/__tests__/product-selection-table.test.ts`
- Modify: `src/modules/auto-seo/__tests__/product-detail-hydration.test.ts`
- Modify: `src/modules/auto-seo/__tests__/auto-seo-session.test.ts`

**Interfaces:**
- Consumes: `AutoSeoClient.getProductEligibility`, session preferences, `selectNextAutoSeoBatch`, and accepted/skipped run outcomes.
- Produces: smart batch controls, eligibility badges/filter/counts, transient preview state, and accurate operator notifications.

- [ ] **Step 1: Write failing toolbar/table tests**

Assert the toolbar renders the exact batch options `10/20/50/100`, defaults to `50`, labels the action `Chọn 50 sản phẩm tiếp theo`, disables it while preview is loading or unavailable, and displays counts. Assert the table can filter `needs_seo`, shows localized badges for all five states, and retains existing search/Shopify-status behavior.

- [ ] **Step 2: Run component tests and verify failure**

Run: `node --import tsx --test src/modules/auto-seo/__tests__/product-selection-table.test.ts src/modules/auto-seo/__tests__/auto-seo-session.test.ts`  
Expected: FAIL because smart batch props and controls are absent.

- [ ] **Step 3: Implement toolbar, filter, and badge UI**

Add accessible labels and typed callbacks. Keep the existing Load, Select all visible, Clear visible, and Run controls. Use existing Tailwind visual conventions; do not introduce global CSS or a UI dependency.

- [ ] **Step 4: Write failing page integration tests**

Assert that loading products requests eligibility for the selected store, smart select replaces rather than appends the current selection, store switch clears selection/preview and ignores an old pending response, eligibility failure leaves manual selection usable, and preview is refreshed after a run.

Also assert a detail-hydration failure names the failed product and dispatches nothing. Assert run notifications and navigation use `acceptedCount`, not originally selected/hydrated count, and report skipped unchanged products without treating an all-skipped successful run as an error.

- [ ] **Step 5: Implement page orchestration**

Keep eligibility in transient component state. Add a monotonically increasing eligibility request ID, paired with the selected store ID, before applying an async response. Fetch preview after products load and after a completed run. Use `selectNextAutoSeoBatch` for the smart action and preserve explicit **Run Auto SEO** execution.

- [ ] **Step 6: Run focused UI tests**

Run: `node --import tsx --test src/modules/auto-seo/__tests__/smart-batch.test.ts src/modules/auto-seo/__tests__/auto-seo-session.test.ts src/modules/auto-seo/__tests__/product-selection-table.test.ts src/modules/auto-seo/__tests__/product-detail-hydration.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/auto-seo/ui/AutoSeoPage.tsx src/modules/auto-seo/ui/components/AutoSeoToolbar.tsx src/modules/auto-seo/ui/components/ProductSelectionTable.tsx src/modules/auto-seo/ui/components/product-filter.ts src/modules/auto-seo/__tests__/product-selection-table.test.ts src/modules/auto-seo/__tests__/product-detail-hydration.test.ts src/modules/auto-seo/__tests__/auto-seo-session.test.ts
git commit -m "feature(main): add smart seo batch controls"
```

### Task 6: Cross-Flow Regression Verification

**Files:**
- Modify only tests that reveal an actual compatibility regression in the files already scoped above.

**Interfaces:**
- Consumes: completed Tasks 1-5.
- Produces: verified Auto SEO → Queue/Review behavior with no Shopify publishing side effect.

- [ ] **Step 1: Run focused cross-flow tests**

Run: `node --import tsx --test gateway/__tests__/seo-review-lifecycle.test.ts gateway/__tests__/custom-gpt-e2e.test.ts gateway/__tests__/codex-seo-mcp.test.ts`  
Expected: PASS, including correct `storeId`, Codex/Custom GPT queue handoff, Gemini Review persistence, and no publish call.

- [ ] **Step 2: Run full required verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run build:mock
```

Expected: all commands exit `0` with no TypeScript or build errors.

- [ ] **Step 3: Inspect the final diff and repository state**

Run:

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -8
```

Expected: no whitespace errors; only intended task files are modified; branch is `rua`; no generated files or secrets are staged.

- [ ] **Step 4: Commit any test-only compatibility corrections**

If Step 1 or 2 required scoped test corrections, commit them separately:

```bash
git add gateway/__tests__/seo-review-lifecycle.test.ts gateway/__tests__/custom-gpt-e2e.test.ts gateway/__tests__/codex-seo-mcp.test.ts
git commit -m "test(orchestrator): cover smart seo batch flow"
```

If no correction was needed, do not create an empty commit.
