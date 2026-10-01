# Auto SEO PostgreSQL Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the existing Auto SEO PostgreSQL work into the current application while preserving smart batching, store-aware routing, queue leasing, review deletion, and mock behavior.

**Architecture:** Treat current `main` as the behavioral source of truth and import the feature branch's PostgreSQL repositories, migrations, and startup bootstrap as infrastructure. Production performs atomic input-hash classification and backup insertion in PostgreSQL before dispatch; Auto SEO reviews also live in PostgreSQL, while the existing Codex/Custom GPT lease queue remains unchanged. Browser code delegates production SEO execution to the backend and keeps local execution only in mock mode.

**Tech Stack:** TypeScript, React, Vite, Node HTTP gateway, PostgreSQL via `pg`, Vitest, SQLite legacy migration adapters.

**Spec:** `docs/superpowers/specs/2026-10-01-auto-seo-postgres-integration-design.md`

## Global Constraints

- Work only on the existing `rua` branch; do not create another branch or worktree.
- Current `main` behavior wins every merge conflict; PostgreSQL code must be adapted to it rather than restoring older behavior.
- PostgreSQL is mandatory for production Auto SEO backup and Auto SEO-origin review storage; no silent SQLite fallback is allowed.
- The Codex/Custom GPT lease queue and its per-batch ownership rules remain on the current queue store.
- Mock mode remains in-memory and must not require PostgreSQL or network access.
- Preserve smart batch sizes `10`, `20`, `50`, and `100`, with default `50`, input-hash deduplication, needs-SEO filtering, and store-aware navigation.
- Auto SEO Review delete is a soft delete and must not delete Shopify synchronization audit records.
- Never publish to Shopify from this workflow.
- Keep database credentials server-only in `AUTO_SEO_DATABASE_URL`; never expose them through a `VITE_` variable.
- Follow strict TypeScript and repository module boundaries; do not use `any`, `@ts-ignore`, or hidden production fallbacks.

## Review Focus

- Two workers submit the same unchanged product concurrently: exactly one revision is accepted and dispatched; Task 2 pins this with a concurrent repository test.
- A previous matching revision is `FAILED`: the next submission is accepted as a retry; Task 2 pins this with a repository classification test.
- A mixed batch contains active, unchanged, changed, and never-processed products: counts, reasons, and accepted IDs remain exact; Task 3 pins this at the HTTP handler boundary.
- PostgreSQL recovery is unavailable while a Codex queue batch is waiting: recovery reports a safe diagnostic but queue processing continues; Task 5 pins this with a runtime test.
- An Auto SEO review is deleted after a Shopify sync attempt: it disappears from review queries while its sync audit remains intact; Task 4 pins this with a PostgreSQL review deletion test.

---

### Task 1: Integrate the PostgreSQL Foundation Without Regressing Current Behavior

**Files:**
- Merge from: `origin/feature/orchestrator-add-auto-seo-preprocessor`
- Keep current behavior in: `gateway/auto-seo-handler.ts`
- Keep current behavior in: `gateway/server.ts`
- Keep current behavior in: `src/modules/auto-seo/ui/AutoSeoPage.tsx`
- Import: `gateway/auto-seo-backup-repository.ts`
- Import: `gateway/auto-seo-postgres-repository.ts`
- Import: `gateway/auto-seo-postgres-schema.ts`
- Import: `gateway/auto-seo-startup.ts`
- Import: `gateway/auto-seo-migration.ts`
- Import: `gateway/auto-seo-review-postgres.ts`
- Import relevant PostgreSQL tests under: `gateway/__tests__/`

**Interfaces:**
- Consumes: current `main` smart-batch, eligibility, delete-review, store-routing, and queue behavior.
- Produces: a merge commit on `rua` containing the feature branch history and PostgreSQL infrastructure, with behavioral files initially resolved to the current `main` versions for later TDD adaptation.

- [ ] **Step 1: Start the non-committing merge and record all conflicts**

Run: `git merge --no-ff --no-commit origin/feature/orchestrator-add-auto-seo-preprocessor`

Expected: merge pauses with conflicts only in the known overlapping behavioral files; no unrelated files are discarded.

- [ ] **Step 2: Resolve conflicts using current `main` behavior as the baseline**

Resolve `gateway/auto-seo-handler.ts`, `gateway/server.ts`, and `src/modules/auto-seo/ui/AutoSeoPage.tsx` to their current `rua` versions. Retain new PostgreSQL repositories, schema, startup, migration utilities, tests, documentation, and required `pg` dependency changes from the feature branch. For other modified behavioral files, retain current `rua` behavior until the owning task ports the PostgreSQL implementation deliberately.

- [ ] **Step 3: Verify the merge foundation compiles before the merge commit**

Run: `npm run typecheck`

Expected: PASS. If imported tests or infrastructure require a deliberate interface adaptation, make only the minimum compile-safe change and leave behavioral wiring for later tasks.

- [ ] **Step 4: Commit the resolved merge**

```bash
git add .
git commit -m "merge(orchestrator): integrate auto seo postgres foundation"
```

### Task 2: Implement Atomic PostgreSQL Smart-Batch Claims

**Files:**
- Modify: `gateway/auto-seo-backup-repository.ts`
- Modify: `gateway/auto-seo-postgres-schema.ts`
- Modify: `gateway/auto-seo-postgres-repository.ts`
- Modify: `gateway/auto-seo-migration.ts`
- Modify: `gateway/auto-seo-db.ts`
- Test: `gateway/__tests__/auto-seo-postgres-repository.test.ts`
- Test: `gateway/__tests__/auto-seo-migration.test.ts`
- Test: `gateway/__tests__/auto-seo-smart-batch.test.ts`

**Interfaces:**
- Consumes: `calculateAutoSeoInputHash` from `gateway/auto-seo-input-hash.ts` and existing downstream statuses `NOT_SENT`, `SENT`, and `FAILED`.
- Produces: `AutoSeoBackupRepository.claimBackupBatch(input): Promise<AutoSeoBackupClaimResult>`, where each candidate includes `storeId`, `productId`, `seoInputSha256`, and backup payload; the result includes exact `acceptedRecords` and `skippedProducts` with `ACTIVE_DUPLICATE` or `UNCHANGED` reasons.

- [ ] **Step 1: Write failing repository tests for classification and concurrency**

Add tests named:

- `accepts a product with no matching input hash`;
- `skips a matching NOT_SENT revision as ACTIVE_DUPLICATE`;
- `skips a matching SENT revision as UNCHANGED`;
- `accepts a matching FAILED revision as retry`;
- `accepts exactly one of two concurrent identical submissions`.

The concurrency assertion must prove the combined accepted count is `1`, not merely that one call succeeds.

- [ ] **Step 2: Run the focused repository tests and confirm failure**

Run: `npm test -- gateway/__tests__/auto-seo-postgres-repository.test.ts`

Expected: FAIL because `claimBackupBatch` and/or `seo_input_sha256` do not yet exist.

- [ ] **Step 3: Add the claim contract and PostgreSQL schema**

Add `seo_input_sha256 TEXT` plus index `(store_id, product_id, seo_input_sha256, downstream_status)`. Define explicit `AutoSeoBackupClaimCandidate`, `AutoSeoBackupSkippedProduct`, and `AutoSeoBackupClaimResult` types in the repository contract.

- [ ] **Step 4: Implement `claimBackupBatch` atomically**

Within one transaction, acquire PostgreSQL transaction advisory locks for `(storeId, productId)` in stable product-ID order, classify matching hashes, and insert only accepted records. Do not hold a network/provider call inside the transaction. Make the SQLite legacy adapter satisfy the same contract for deterministic unit tests.

- [ ] **Step 5: Cover migration of present and missing hashes**

Add assertions that legacy hashes are copied when present and `NULL` hashes stay conservative so eligibility treats them as changed.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- gateway/__tests__/auto-seo-postgres-repository.test.ts gateway/__tests__/auto-seo-migration.test.ts gateway/__tests__/auto-seo-smart-batch.test.ts`

Expected: PASS; PostgreSQL integration cases may skip only when `AUTO_SEO_TEST_DATABASE_URL` is not configured, while pure contract tests must run.

- [ ] **Step 7: Commit**

```bash
git add gateway/auto-seo-backup-repository.ts gateway/auto-seo-postgres-schema.ts gateway/auto-seo-postgres-repository.ts gateway/auto-seo-migration.ts gateway/auto-seo-db.ts gateway/__tests__/auto-seo-postgres-repository.test.ts gateway/__tests__/auto-seo-migration.test.ts gateway/__tests__/auto-seo-smart-batch.test.ts
git commit -m "feature(gateway): claim postgres auto seo revisions"
```

### Task 3: Route Auto SEO Runs and Eligibility Through PostgreSQL

**Files:**
- Modify: `gateway/auto-seo-handler.ts`
- Modify: `gateway/auto-seo-eligibility.ts`
- Modify: `gateway/vite-plugin.ts`
- Test: `gateway/__tests__/auto-seo-smart-batch.test.ts`
- Test: `gateway/__tests__/auto-seo-postgres-runtime.test.ts`
- Test: `gateway/__tests__/auto-seo-default-runtime-local.test.ts`

**Interfaces:**
- Consumes: `AutoSeoBackupRepository.claimBackupBatch(...)` from Task 2 and the existing queue service for active Codex/Custom GPT products.
- Produces: asynchronous run and eligibility handlers whose production defaults use PostgreSQL, while explicit legacy test adapters and mock mode remain isolated.

- [ ] **Step 1: Write failing handler tests for a mixed batch**

Submit active, unchanged, changed, retry, and never-processed products together. Assert exact `acceptedProductIds`, `acceptedCount`, `skippedProducts`, and `skippedCount`, and assert the provider receives only accepted products.

- [ ] **Step 2: Write failing eligibility tests for combined storage state**

Assert PostgreSQL backup/review history yields `never_processed`, `changed`, `retry`, and `current`, while active queue leases override those states to `active` for the same store only.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npm test -- gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-postgres-runtime.test.ts`

Expected: FAIL because handlers still read SQLite or do not use the async repository contract.

- [ ] **Step 4: Port the run handler to the repository claim**

Calculate hashes at the server boundary, call `claimBackupBatch`, dispatch only accepted products, and preserve the current response fields and per-store queue target. Production construction must fail when PostgreSQL configuration is missing; it must not silently instantiate SQLite.

- [ ] **Step 5: Port eligibility to PostgreSQL-backed asynchronous reads**

Read latest backup and Auto SEO review state from the PostgreSQL repositories, merge current queue activity by `storeId` and `productId`, and retain the five existing state names. Treat preview as advisory; the run handler still rechecks atomically.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-postgres-runtime.test.ts gateway/__tests__/auto-seo-default-runtime-local.test.ts`

Expected: PASS, including the mixed-batch counts and no silent local production fallback.

- [ ] **Step 7: Commit**

```bash
git add gateway/auto-seo-handler.ts gateway/auto-seo-eligibility.ts gateway/vite-plugin.ts gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-postgres-runtime.test.ts gateway/__tests__/auto-seo-default-runtime-local.test.ts
git commit -m "feature(gateway): run smart auto seo on postgres"
```

### Task 4: Preserve Full SEO Review Behavior on PostgreSQL

**Files:**
- Modify: `gateway/auto-seo-review-postgres.ts`
- Modify: `gateway/auto-seo-postgres-schema.ts`
- Modify: `gateway/seo-review-handler.ts`
- Modify: `gateway/auto-seo-review-migration.ts`
- Test: `gateway/__tests__/auto-seo-review-postgres.test.ts`
- Test: `gateway/__tests__/auto-seo-review-migration.test.ts`
- Test: `gateway/__tests__/seo-review-handler.test.ts`
- Test: `src/pages/seo-review/__tests__/delete-review-product.test.ts`

**Interfaces:**
- Consumes: exact `backup_id` linkage from Task 2 and the existing non-Auto-SEO review handlers.
- Produces: PostgreSQL Auto SEO review operations for list, read, edit, status update, and soft delete; non-Auto-SEO sources keep their current storage and API behavior.

- [ ] **Step 1: Write failing soft-delete and source-isolation tests**

Assert a deleted Auto SEO review is absent from list/read responses, its underlying row records deletion rather than disappearing, and a pre-existing Shopify sync audit record remains unchanged. Assert deleting an Auto SEO review does not hide Pinterest, crawler, or queue-origin reviews.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- gateway/__tests__/auto-seo-review-postgres.test.ts gateway/__tests__/seo-review-handler.test.ts src/pages/seo-review/__tests__/delete-review-product.test.ts`

Expected: FAIL because the PostgreSQL review repository does not yet implement current delete semantics.

- [ ] **Step 3: Add PostgreSQL soft deletion and complete repository methods**

Add nullable `deleted_at`, exclude deleted records from normal reads, and implement the existing list/read/edit/status/delete semantics. Keep Shopify sync audit data outside the delete update.

- [ ] **Step 4: Route only Auto SEO-origin reviews to PostgreSQL**

Preserve the current consolidated API contract and source filters. Route `source=auto_seo` to PostgreSQL without changing Pinterest, crawler, or current queue-origin review behavior.

- [ ] **Step 5: Update review migration and run focused tests**

Run: `npm test -- gateway/__tests__/auto-seo-review-postgres.test.ts gateway/__tests__/auto-seo-review-migration.test.ts gateway/__tests__/seo-review-handler.test.ts src/pages/seo-review/__tests__/delete-review-product.test.ts`

Expected: PASS, including soft deletion and preserved sync audit.

- [ ] **Step 6: Commit**

```bash
git add gateway/auto-seo-review-postgres.ts gateway/auto-seo-postgres-schema.ts gateway/seo-review-handler.ts gateway/auto-seo-review-migration.ts gateway/__tests__/auto-seo-review-postgres.test.ts gateway/__tests__/auto-seo-review-migration.test.ts gateway/__tests__/seo-review-handler.test.ts src/pages/seo-review/__tests__/delete-review-product.test.ts
git commit -m "feature(gateway): store auto seo reviews in postgres"
```

### Task 5: Bootstrap PostgreSQL and Recover Outbox Safely

**Files:**
- Modify: `gateway/auto-seo-startup.ts`
- Modify: `gateway/server.ts`
- Modify: `gateway/custom-gpt-seo/auto-seo-outbox.ts`
- Modify: `gateway/custom-gpt-seo/runtime.ts`
- Modify: `.env.example`
- Modify: `.env.production.example`
- Modify: `deploy/server/Dockerfile`
- Modify: `deploy/client/nginx.conf`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `gateway/__tests__/auto-seo-startup.test.ts`
- Test: `gateway/__tests__/custom-gpt-outbox.test.ts`
- Test: `gateway/__tests__/custom-gpt-runtime.test.ts`

**Interfaces:**
- Consumes: Task 2 backup repository, Task 4 review repository, and existing Custom GPT/Codex queue runtime.
- Produces: `startGatewayServerWhenReady(...)` that verifies PostgreSQL before listening, registers both Auto SEO routes, and isolates outbox recovery failure from queue leasing.

- [ ] **Step 1: Write failing startup and recovery-isolation tests**

Assert the server does not listen before successful schema verification, fails closed on an invalid database, registers both `/api/auto-seo/run` and `/api/auto-seo/eligibility`, and continues a queue tick when pending-backup recovery rejects.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- gateway/__tests__/auto-seo-startup.test.ts gateway/__tests__/custom-gpt-outbox.test.ts gateway/__tests__/custom-gpt-runtime.test.ts`

Expected: FAIL at the missing combined startup/runtime behavior.

- [ ] **Step 3: Combine startup bootstrap with current server routes**

Initialize and verify backup/review schemas before `listen`, preserve the current direct-module detection, and register both Auto SEO endpoints and all existing routes.

- [ ] **Step 4: Port outbox recovery to asynchronous repositories**

Recover pending provider handoffs through PostgreSQL. Catch recovery failure at the tick boundary, emit a safe diagnostic without secrets, and continue Codex/Custom GPT queue processing with the current store/provider lease rules.

- [ ] **Step 5: Update server-only environment and deployment configuration**

Document `AUTO_SEO_DATABASE_URL`, keep it out of browser variables, retain required runtime TypeScript execution support, and ensure deployment waits for PostgreSQL readiness.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- gateway/__tests__/auto-seo-startup.test.ts gateway/__tests__/custom-gpt-outbox.test.ts gateway/__tests__/custom-gpt-runtime.test.ts gateway/__tests__/gateway.test.ts`

Expected: PASS, including continued queue processing after recovery failure.

- [ ] **Step 7: Commit**

```bash
git add gateway/auto-seo-startup.ts gateway/server.ts gateway/custom-gpt-seo/auto-seo-outbox.ts gateway/custom-gpt-seo/runtime.ts .env.example .env.production.example deploy/server/Dockerfile deploy/client/nginx.conf package.json package-lock.json gateway/__tests__/auto-seo-startup.test.ts gateway/__tests__/custom-gpt-outbox.test.ts gateway/__tests__/custom-gpt-runtime.test.ts
git commit -m "feature(gateway): bootstrap auto seo postgres runtime"
```

### Task 6: Make Production SEO Backend-Owned Without Losing Current UI

**Files:**
- Modify: `src/modules/auto-seo/routes.tsx`
- Modify: `src/modules/auto-seo/ui/AutoSeoPage.tsx`
- Modify: `src/modules/auto-seo/ui/components/AutoSeoToolbar.tsx`
- Modify: `src/app/routes/AppRoutes.tsx`
- Test: `src/modules/auto-seo/__tests__/auto-seo-double-run.test.ts`
- Test: `src/modules/auto-seo/__tests__/smart-batch.test.ts`
- Test: `src/modules/auto-seo/__tests__/auto-seo-session.test.ts`

**Interfaces:**
- Consumes: run response fields `acceptedProductIds`, `acceptedCount`, `skippedProducts`, `skippedCount`, and current store slug.
- Produces: `AutoSeoPage` prop `backendRunsSeo: boolean`; production passes `true`, mock passes `false`.

- [ ] **Step 1: Write failing client tests for single execution and routing**

Assert production calls `/api/auto-seo/run` once and never calls the browser SEO runner afterward. Assert Codex/Custom GPT navigates to SEO Queue for the selected store, Gemini navigates to SEO Review for the selected store, and notifications show exact accepted/skipped counts.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- src/modules/auto-seo/__tests__/auto-seo-double-run.test.ts src/modules/auto-seo/__tests__/smart-batch.test.ts`

Expected: FAIL because production still allows duplicate browser execution or lacks the prop wiring.

- [ ] **Step 3: Add `backendRunsSeo` without replacing current smart controls**

When `backendRunsSeo` is true, trust the successful server response, refresh eligibility, notify using server counts, and navigate by provider/store without invoking local SEO. When false, retain current mock simulation. Preserve batch sizes, default `50`, needs-SEO filters, localized badges, and deterministic priority selection.

- [ ] **Step 4: Wire environment behavior through routes**

Pass `backendRunsSeo={environment !== "mock"}` through the module route boundary without reading `import.meta.env` in business/UI code.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/modules/auto-seo/__tests__/auto-seo-double-run.test.ts src/modules/auto-seo/__tests__/smart-batch.test.ts src/modules/auto-seo/__tests__/auto-seo-session.test.ts`

Expected: PASS; mock mode remains local and production executes only once.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auto-seo/routes.tsx src/modules/auto-seo/ui/AutoSeoPage.tsx src/modules/auto-seo/ui/components/AutoSeoToolbar.tsx src/app/routes/AppRoutes.tsx src/modules/auto-seo/__tests__/auto-seo-double-run.test.ts src/modules/auto-seo/__tests__/smart-batch.test.ts src/modules/auto-seo/__tests__/auto-seo-session.test.ts
git commit -m "fix(main): prevent duplicate production auto seo runs"
```

### Task 7: Verify Migration, Boundaries, and the Complete Workflow

**Files:**
- Modify if required: `gateway/auto-seo-migrate-local.ts`
- Modify if required: `gateway/auto-seo-review-migrate-local.ts`
- Modify: `gateway/auto-seo-b2-migration.md`
- Modify: `gateway/auto-seo-b3-runtime.md`
- Test: all affected test suites

**Interfaces:**
- Consumes: completed PostgreSQL backup, eligibility, review, startup, outbox, and UI behavior from Tasks 2–6.
- Produces: a verified `rua` branch ready to push and merge into `main`, with no Shopify publication side effect.

- [ ] **Step 1: Run migration dry-run and idempotency tests**

Run: `npm test -- gateway/__tests__/auto-seo-migration.test.ts gateway/__tests__/auto-seo-review-migration.test.ts`

Expected: PASS for copied hashes, legacy null hashes, exact backup/review links, repeated execution, and non-destructive source handling.

- [ ] **Step 2: Run all Auto SEO, review, and queue regression tests**

Run: `npm test -- gateway/__tests__/auto-seo-smart-batch.test.ts gateway/__tests__/auto-seo-postgres-runtime.test.ts gateway/__tests__/auto-seo-review-postgres.test.ts gateway/__tests__/custom-gpt-outbox.test.ts gateway/__tests__/custom-gpt-runtime.test.ts gateway/__tests__/seo-review-handler.test.ts src/modules/auto-seo/__tests__ src/pages/seo-review/__tests__`

Expected: PASS with no Shopify publish call in Auto SEO or soft-delete tests.

- [ ] **Step 3: Run the required repository verification**

Run each command separately:

```bash
npm test
npm run typecheck
npm run build
npm run build:mock
```

Expected: all commands exit `0` from the current `rua` worktree.

- [ ] **Step 4: Inspect the final diff and branch state**

Run: `git status --short --branch` and `git diff --check origin/main...HEAD`

Expected: no unstaged task changes, no conflict markers or whitespace errors, and only the approved PostgreSQL integration plus its documentation/tests.

- [ ] **Step 5: Commit any final migration/documentation corrections**

```bash
git add gateway/auto-seo-migrate-local.ts gateway/auto-seo-review-migrate-local.ts gateway/auto-seo-b2-migration.md gateway/auto-seo-b3-runtime.md
git commit -m "docs(gateway): finalize auto seo postgres migration"
```

Skip this commit when those files required no final change.

