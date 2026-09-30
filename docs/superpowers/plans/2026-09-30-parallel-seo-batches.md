# Parallel SEO Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow separately authenticated Codex machines to claim and resume disjoint SEO batches for the same store while keeping legacy one-token installations compatible.

**Architecture:** Parse MCP configuration into store/worker credentials, derive an immutable owner ID from the authenticated credential, and persist that owner on each batch. SQLite `BEGIN IMMEDIATE` remains the claim fence, but the active-batch constraint becomes owner-scoped; the admin API and queue UI list every active batch safely.

**Tech Stack:** TypeScript, Node.js SQLite, MCP SDK, React, Tailwind CSS, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-30-parallel-seo-batches-design.md`

## Global Constraints

- Work directly on branch `rua`; do not create another branch or worktree.
- Do not push, merge, publish, or modify Shopify data.
- Preserve the existing MCP tool names and client-visible input schemas.
- Preserve legacy `{"store":"token"}` MCP configuration as worker `default`.
- Never expose MCP bearer tokens in responses, logs, or persistent storage.
- Add no dependency and do not weaken TypeScript strict mode.
- Follow TDD: every behavior change starts with a focused failing test.

## Review Focus

- A duplicate bearer token appearing under two workers or stores must fail environment parsing; Task 1 adds this test.
- A retry using the same request ID under a different owner must not receive the first owner's lease; Task 2 adds this test.
- Concurrent claims against one file-backed database must remain disjoint after SQLite serializes the writers; Task 2 adds this test.
- Migrated active Codex and Custom GPT batches must remain resumable by their legacy owners; Task 2 adds this test.
- The admin surface must not confuse worker labels with secrets and must release only the selected batch; Task 4 adds API/view-model tests.

---

### Task 1: Parse worker-scoped MCP credentials

**Files:**
- Modify: `src/config/custom-gpt-environment.ts`
- Modify: `src/config/__tests__/custom-gpt-environment.test.ts`

**Interfaces:**
- Produces: `McpCredential { readonly storeId: string; readonly workerId: string; readonly secret: string }` and `CustomGptEnvironment.mcpCredentials: readonly McpCredential[]`.
- Consumes: Existing action credentials and `GATEWAY_AUTH_TOKEN` for cross-secret validation.

- [ ] **Step 1: Write failing environment tests**

Add tests proving that the parser:

- converts `{"capozen":"legacy-token"}` to `[{ storeId: "capozen", workerId: "default", secret: "legacy-token" }]`;
- converts `{"capozen":{"office-pc":"office-token","laptop":"laptop-token"}}` to two credentials in input order;
- rejects empty worker maps, invalid worker IDs, empty worker secrets, and duplicate secrets across workers or stores;
- rejects worker secrets matching an Action key or `GATEWAY_AUTH_TOKEN`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test src/config/__tests__/custom-gpt-environment.test.ts`

Expected: FAIL because `mcpCredentials` and nested worker configuration are not implemented.

- [ ] **Step 3: Implement credential parsing**

Export `McpCredential`, replace `mcpKeys` with `mcpCredentials`, accept both legacy strings and worker maps, validate store/worker IDs with the existing safe identifier rule, trim secrets, and enforce global secret uniqueness plus existing cross-credential checks.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx tsx --test src/config/__tests__/custom-gpt-environment.test.ts`

Expected: all environment tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/config/custom-gpt-environment.ts src/config/__tests__/custom-gpt-environment.test.ts
git commit -m "feature(gateway): parse Codex worker credentials"
```

### Task 2: Make batch leases owner-scoped and atomic

**Files:**
- Modify: `gateway/custom-gpt-seo/queue.ts`
- Modify: `gateway/__tests__/custom-gpt-queue.test.ts`
- Modify: `src/modules/custom-gpt-seo/types.ts`
- Modify: `gateway/__tests__/custom-gpt-outbox.test.ts` only if its call needs the explicit default owner
- Modify: `gateway/__tests__/custom-gpt-handler.test.ts` only if its direct queue calls need the explicit Custom GPT owner

**Interfaces:**
- Consumes: Owner IDs formatted as `codex_mcp:<workerId>` or `custom_gpt`.
- Produces: `claim(storeId, requestId, provider, ownerId)`, `activeBatch(storeId, ownerId)`, and `activeBatches(storeId)`; `GptSeoBatch.ownerId` identifies the safe configured worker namespace.

- [ ] **Step 1: Write failing owner-isolation tests**

Add tests proving that:

- two Codex owners claim distinct pending jobs for one store and both appear in `activeBatches`;
- a second claim by the same owner is rejected while another owner's active batch is unaffected;
- a request ID already owned by another owner is rejected without returning its lease token;
- releasing or expiring one owner returns only that batch's unfinished jobs;
- provider-scoped Custom GPT and Codex owners can claim concurrently without mixing jobs.

- [ ] **Step 2: Write a failing file-backed concurrency test**

Open two `DatabaseSync` connections to the same temporary database, create two queue instances, issue competing owner claims, and assert the returned job ID sets are disjoint and together contain all selected jobs.

- [ ] **Step 3: Write failing migration tests**

Create the version-2 schema manually with active rows for both providers, construct `CustomGptQueue`, and assert Codex migrates to `codex_mcp:default`, Custom GPT migrates to `custom_gpt`, and `PRAGMA user_version` becomes `3`.

- [ ] **Step 4: Run the focused tests and verify RED**

Run: `npx tsx --test gateway/__tests__/custom-gpt-queue.test.ts`

Expected: FAIL because batches have no `owner_id` and claims are still store-wide.

- [ ] **Step 5: Implement schema version 3 and owner-scoped queue methods**

Add and migrate `gpt_batches.owner_id`; include `ownerId` in `batch`; expire all stale batches before claims; scope the active-batch check to the requesting owner; reject cross-owner request-ID retries before returning a batch; retain `BEGIN IMMEDIATE` around selection and assignment; add an ordered `activeBatches(storeId)` administrative query.

- [ ] **Step 6: Update existing direct queue callers to explicit stable owners**

Pass `custom_gpt` for Custom GPT tests/handlers and `codex_mcp:default` for legacy Codex tests where needed. Do not introduce a store-wide fallback owner in production call paths.

- [ ] **Step 7: Run queue and dependent gateway tests and verify GREEN**

Run: `npx tsx --test gateway/__tests__/custom-gpt-queue.test.ts gateway/__tests__/custom-gpt-handler.test.ts gateway/__tests__/custom-gpt-outbox.test.ts`

Expected: all named tests pass.

- [ ] **Step 8: Commit Task 2**

```bash
git add gateway/custom-gpt-seo/queue.ts gateway/__tests__/custom-gpt-queue.test.ts gateway/__tests__/custom-gpt-handler.test.ts gateway/__tests__/custom-gpt-outbox.test.ts src/modules/custom-gpt-seo/types.ts
git commit -m "feature(gateway): isolate SEO batches by worker"
```

### Task 3: Bind MCP sessions to authenticated workers

**Files:**
- Modify: `gateway/custom-gpt-seo/mcp-handler.ts`
- Modify: `gateway/custom-gpt-seo/mcp-server.ts`
- Modify: `gateway/custom-gpt-seo/workflow.ts`
- Modify: `gateway/custom-gpt-seo/runtime.ts`
- Modify: `gateway/custom-gpt-seo/handler.ts`
- Modify: `gateway/__tests__/codex-seo-mcp.test.ts`
- Modify: `gateway/__tests__/custom-gpt-e2e.test.ts` only if workflow signatures require it

**Interfaces:**
- Consumes: `mcpCredentials` from Task 1 and owner-scoped queue methods from Task 2.
- Produces: `createCodexSeoMcpServer({ workflow, storeId, ownerId })`; `getWork(storeId, provider, ownerId)` and `claim(storeId, provider, ownerId, requestId)`.

- [ ] **Step 1: Write failing MCP isolation tests**

Configure two credentials for `capozen`, connect two HTTP MCP clients, claim one batch from each, and assert:

- batch job ID sets are disjoint;
- each `get_seo_work` returns only that client's active batch;
- neither response contains the other client's lease token;
- the legacy `default` credential still claims and resumes normally.

- [ ] **Step 2: Run the focused MCP test and verify RED**

Run: `npx tsx --test gateway/__tests__/codex-seo-mcp.test.ts`

Expected: FAIL because authentication resolves only a store and workflow lookup is store-wide.

- [ ] **Step 3: Thread the authenticated owner through the MCP stack**

Resolve bearer tokens against `mcpCredentials`; construct `ownerId` only on the server; pass it into MCP server tool handlers and owner-scoped workflow calls. Keep all MCP input schemas unchanged.

- [ ] **Step 4: Assign Custom GPT its fixed owner**

Update Action handler workflow calls to use `custom_gpt`, preserving current Action authentication and provider filtering.

- [ ] **Step 5: Run MCP and Action tests and verify GREEN**

Run: `npx tsx --test gateway/__tests__/codex-seo-mcp.test.ts gateway/__tests__/custom-gpt-e2e.test.ts gateway/__tests__/custom-gpt-handler.test.ts`

Expected: all named tests pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add gateway/custom-gpt-seo/mcp-handler.ts gateway/custom-gpt-seo/mcp-server.ts gateway/custom-gpt-seo/workflow.ts gateway/custom-gpt-seo/runtime.ts gateway/custom-gpt-seo/handler.ts gateway/__tests__/codex-seo-mcp.test.ts gateway/__tests__/custom-gpt-e2e.test.ts gateway/__tests__/custom-gpt-handler.test.ts
git commit -m "feature(gateway): bind MCP batches to workers"
```

### Task 4: Show and release multiple active batches

**Files:**
- Modify: `gateway/custom-gpt-seo/handler.ts`
- Modify: `gateway/__tests__/custom-gpt-handler.test.ts`
- Modify: `src/modules/custom-gpt-seo/service.ts`
- Modify: `src/modules/custom-gpt-seo/mocks/data.ts`
- Modify: `src/modules/custom-gpt-seo/mocks/runner.ts`
- Modify: `src/modules/custom-gpt-seo/ui/seo-queue-view-model.ts`
- Modify: `src/modules/custom-gpt-seo/__tests__/seo-queue-view-model.test.ts`
- Modify: `src/modules/custom-gpt-seo/ui/CustomGptSeoPage.tsx`

**Interfaces:**
- Consumes: `activeBatches(storeId)` and `GptSeoBatch.ownerId` from Task 2.
- Produces: `GptQueuePage.activeBatches: readonly GptSeoBatch[]`; `getBatchOwnerLabel(ownerId: string): string` for safe UI presentation.

- [ ] **Step 1: Write failing admin response and view-model tests**

Assert the admin jobs response contains both active batches for one store, and assert owner labels map `codex_mcp:office-pc` to `office-pc`, `codex_mcp:default` to `Máy mặc định`, and `custom_gpt` to `GPT Custom` without using secrets.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx tsx --test gateway/__tests__/custom-gpt-handler.test.ts src/modules/custom-gpt-seo/__tests__/seo-queue-view-model.test.ts`

Expected: FAIL because the API and view model expose only one active batch and have no owner-label formatter.

- [ ] **Step 3: Implement the multi-batch admin contract and UI**

Return `activeBatches` from `admin/jobs`; retain `activeBatch` as the first entry for compatibility; update real and mock client contracts; render a compact row per active batch with worker label, provider, job count, expiry, and a release button bound to that batch ID.

- [ ] **Step 4: Run focused web and gateway tests and verify GREEN**

Run: `npx tsx --test gateway/__tests__/custom-gpt-handler.test.ts src/modules/custom-gpt-seo/__tests__/service.test.ts src/modules/custom-gpt-seo/__tests__/seo-queue-view-model.test.ts`

Expected: all named tests pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add gateway/custom-gpt-seo/handler.ts gateway/__tests__/custom-gpt-handler.test.ts src/modules/custom-gpt-seo/service.ts src/modules/custom-gpt-seo/mocks/data.ts src/modules/custom-gpt-seo/mocks/runner.ts src/modules/custom-gpt-seo/ui/seo-queue-view-model.ts src/modules/custom-gpt-seo/__tests__/seo-queue-view-model.test.ts src/modules/custom-gpt-seo/ui/CustomGptSeoPage.tsx
git commit -m "feature(main): show parallel SEO batches"
```

### Task 5: Document setup and verify the repository

**Files:**
- Modify: `docs/custom-gpt-seo/codex-mcp.md`
- Modify: `.env.example` only if it currently documents `GPT_SEO_MCP_KEYS_JSON`

**Interfaces:**
- Consumes: Final multi-worker JSON format and legacy compatibility from Tasks 1–4.
- Produces: Operator instructions for assigning one token and worker ID to each Codex machine.

- [ ] **Step 1: Update operator documentation**

Document the nested worker configuration, legacy form, separate-token rule, same-store parallel behavior, resume semantics, and the fact that Codex produces `REVIEW_READY` drafts without publishing to Shopify.

- [ ] **Step 2: Run all required verification**

Run: `npm test`

Expected: all test suites pass.

Run: `npm run typecheck`

Expected: all TypeScript projects pass with no errors.

Run: `npm run build`

Expected: the production build succeeds.

Run: `npm run build:mock`

Expected: the mock build succeeds because the mock queue contract changed.

- [ ] **Step 3: Inspect scope and commit**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors and only planned files are modified.

```bash
git add docs/custom-gpt-seo/codex-mcp.md .env.example
git commit -m "docs(gateway): explain parallel Codex workers"
```

- [ ] **Step 4: Confirm delivery boundary**

Confirm the current branch is `rua`, the working tree is clean, no remote push occurred, and no Shopify publishing path changed.
