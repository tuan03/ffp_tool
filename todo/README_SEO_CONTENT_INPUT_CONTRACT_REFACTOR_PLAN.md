# SEO Content Input Contract Refactor — Team Agents Implementation Plan

**Document status:** Implementation source of truth

**Document version:** 1.0

**Created:** 05/10/2026

**Repository:** FFP Tool

**Primary pilot store:** `jeminise` / `b6-theme-test.myshopify.com`

**Canonical worker flow:** Auto SEO → PostgreSQL queue → `/mcp/seo-worker` → Codex Agent Pack → Review

> This document is an execution plan, not evidence that the refactor has been implemented. The task is complete only after every acceptance gate in this document passes with fresh evidence.

---

## 1. Objective

Refactor SEO Content so its semantic input contract contains exactly three top-level inputs:

1. `images`
2. `niche`
3. `storeProfile`

The required meaning of each input is:

- **Images:** the source of truth for product identity, visible design, visible typography, visual attributes, and every product-specific claim used to generate SEO content.
- **Niche:** a disambiguation hint that helps Codex identify which object in a complex image is the sold product. Niche is not proof that a product has an attribute.
- **Store profile:** versioned configuration for one store. It defines store-wide language, brand/content rules, allowed catalog policies, forbidden claims, and store-specific requirements. For Jeminise it must represent the explicitly configured Comforter, Quilt, and Duvet Cover policy without treating incidental image scenery as product evidence.

No title, description, handle, variant payload, current SEO keyword, site domain, product URL, GSC fact, GA4 fact, free-form operator instruction, or old alt text may enter the SEO generation contract or be exposed to the Codex worker as semantic source material.

Operational metadata remains necessary, but it must be transported separately and must not influence generated content.

---

## 2. Completion definition

The refactor is complete only when all of the following are true:

- `SeoContentInput` and the canonical Codex worker generation contract have exactly three top-level fields: `images`, `niche`, and `storeProfile`.
- Images are the only source of product-specific factual evidence.
- Niche is used only to identify the sold object and frame keyword research.
- Store profile is mandatory, versioned, store-scoped, and explicitly resolved before enqueue.
- The Jeminise profile is supported through the new contract and its three configured bedding offerings are represented by structured policy.
- Product/store identity, source revisions, leases, run IDs, provider settings, and review snapshots live in a separate execution envelope.
- `job_get_context` does not expose old title, description, handle, variants, URLs, old alt text, existing keywords, source snapshot, GSC context, or arbitrary instructions to the Codex generation flow.
- Every product image must be fetched through `job_get_image` before analysis can be saved.
- Image URLs, filenames, and old alt text are transport metadata only and never evidence.
- Ambiguous or unreadable images fail closed into a review/input-required state; the worker does not fabricate generic content from niche alone.
- Existing checkpoints created with the legacy input contract cannot be resumed as if they were V2 checkpoints.
- The worker reaches `REVIEW_READY` for the Jeminise pilot without approving or publishing to Shopify.
- All focused and full automated tests pass with fresh output.
- Code-based integration QA passes against the canonical worker MCP flow.
- Visual QA passes in Chrome using the Auto SEO and Review UI.
- No relevant test is skipped. Environment-dependent unrelated skips must be documented and must not cover changed behavior.
- No secrets, production tokens, raw credentials, or customer data are committed or printed in logs.

---

## 3. Non-goals

This task does not:

- Implement GSC or GA4 ingestion.
- Change SEO benchmark formulas or dashboard metrics.
- Approve or publish a QA draft to Shopify.
- Convert every production store to the new worker protocol.
- Add an OpenAI API integration; Codex remains the reasoning agent through MCP.
- Infer materials, care instructions, certifications, safety claims, personalization support, or variants from store identity alone.
- Change prices, vendor, inventory, variants, product type, or handle on Shopify.
- Remove immutable source snapshots needed for Review, stale-source checks, versioning, rollback, or publish verification.

---

## 4. Current-state architecture and refactor target

### 4.1. Canonical flow

The implementation must target the current worker architecture:

```text
Shopify / Auto SEO
    ↓
Durable source snapshot + operational envelope
    ↓
PostgreSQL gpt_jobs / seo_worker_* state
    ↓
/mcp/seo-worker
    ↓
Codex Agent Pack
    ↓
job_get_context + job_get_image
    ↓
visual analysis → keyword research → conflict control → draft
    ↓
server validation / finalizer
    ↓
REVIEW_READY
```

`/mcp/gpt-seo` is a legacy compatibility flow. It must not remain a path that can bypass the new semantic-input restrictions for converted stores.

### 4.2. Known legacy leakage

The current code exposes or depends on legacy facts in several places:

- `GptSeoInput` contains title, description, handle, product ID, site domain, URL, and image alt.
- Worker product identity is partly read from `job.input.productId`.
- `job_get_context` returns `job.input`, `sourceSnapshot`, source revision, arbitrary settings, variants, and optional GSC context.
- Worker instructions tell Codex to read source variants and descriptions.
- Revision creation reconstructs title, description, handle, and image alt into generation input.
- SEO Content B1 sends title and description to the visual analyzer.
- Text-based heuristics can replace missing pixel evidence.
- B5 fact sheets use original title, description, handle, variants, and existing keywords.
- Cache hashes include legacy semantic fields.
- Filename and fallback-alt generation can depend on the old handle/title/alt.

All such paths must be removed, moved to the operational envelope, or isolated from generation.

### 4.3. Required target separation

```text
                    ┌───────────────────────────┐
                    │ SeoContentInput           │
                    │ - images                  │
                    │ - niche                   │
                    │ - storeProfile            │
                    └─────────────┬─────────────┘
                                  │ allowed to affect content
                                  ▼
                       Codex SEO generation

┌─────────────────────────────────────────────────────────────┐
│ SeoExecutionEnvelope                                        │
│ storeId, productId/sourceIdentity, sourceRevision, run,      │
│ lease, provider, pipeline version, immutable source snapshot │
└──────────────────────────────┬──────────────────────────────┘
                               │ persistence/control only
                               ▼
              queue, stale guard, Review, version, publish
```

The execution envelope must never be serialized into the Codex generation context except for opaque lease/job identifiers required to call tools.

---

## 5. Target contracts

### 5.1. Generation input

The intended public shape is:

```ts
export interface SeoContentInput {
  readonly images: readonly SeoContentImageInput[];
  readonly niche: string;
  readonly storeProfile: SeoStoreProfile;
}
```

No index signature is permitted. No deprecated legacy fields are permitted.

### 5.2. Image input

```ts
export interface SeoContentImageInput {
  readonly id: string;
  readonly url: string;
  readonly contentFingerprint?: string;
}
```

Rules:

- `id` is stable within the job and is used for evidence citations.
- `url` is used only by the trusted server to download bytes.
- Codex receives `imageId` and image bytes, not the URL.
- `contentFingerprint` is operational cache evidence and is not sent to prompts.
- `alt`, filename, path fragments, query parameters, and neighboring page text are forbidden as visual evidence.
- At least one valid image is required.

### 5.3. Store profile

The exact implementation can evolve during the contract phase, but it must preserve this separation:

```ts
export interface SeoStoreProfile {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly locale: string;
  readonly language: string;
  readonly niche: string;
  readonly brandVoice: readonly string[];
  readonly contentRules: readonly string[];
  readonly prohibitedClaims: readonly string[];
  readonly seoConstraints: {
    readonly maxTitleCharacters: number;
    readonly maxDescriptionCharacters: number;
    readonly maxAltCharacters: number;
  };
  readonly catalogPolicies?: readonly SeoCatalogPolicy[];
}
```

Store-profile rules:

- Profile data is versioned and immutable within one job.
- `profileVersion` participates in the generation hash and checkpoint compatibility.
- Language and store instructions belong in the structured profile; arbitrary `settings.instructions` are not a fourth semantic input.
- A store profile may contain an explicitly authorized, store-wide catalog policy only when the business guarantees it for the profile's applicability scope.
- Store profile must not turn scene objects into product facts.
- Store profile must not authorize a claim merely because the store commonly sells that product type.

Jeminise V2 must model the configured Comforter, Quilt, and Duvet Cover policy as structured configuration. The policy must state its applicability explicitly. If a product cannot be proven to fall under that applicability rule using image identity plus niche, the worker must not claim all three offerings and must request review.

### 5.4. Execution envelope

Operational fields move outside `SeoContentInput`:

```ts
export interface SeoExecutionEnvelope {
  readonly storeId: string;
  readonly productId?: string;
  readonly source: "amazon" | "auto_seo";
  readonly sourceIdentity: string;
  readonly sourceRevision?: string;
  readonly shopifyUpdatedAt?: string;
  readonly providerId: string;
  readonly pipelineVersion: string;
  readonly originalSnapshot: unknown;
}
```

Rules:

- This envelope may drive store isolation, leases, stale checks, Review hydration, versioning, publish targeting, and audit logs.
- It may not be read by B1/B2/B3/B5 prompts or content generators.
- `productId` must be removed from `GptSeoInput`; worker product keys use the envelope.
- Original source data remains encrypted/protected server-side and is never returned by `job_get_context` for generation.

### 5.5. Worker context returned to Codex

`job_get_context` may return:

- Job/lease identifiers.
- The exact niche.
- The resolved, versioned store profile.
- Image IDs.
- Derived checkpoints created under the same V2 contract.
- Common output schemas and non-product-specific safety rules.

It must not return:

- Original title or description.
- Handle, product URL, site domain, product ID, or source identity.
- Variants or variant summary.
- Existing keywords.
- Old alt text, image URL, or filename.
- Shopify source snapshot.
- GSC/GA4 performance facts for generation.
- Arbitrary revision/operator instructions.

GSC tools remain available for the separate performance-audit workflow. They are not queue-generation input for this task.

---

## 6. Behavioral rules by pipeline stage

### B1 — Product understanding

- Inputs: image bytes and niche only.
- Store profile is not used as pixel evidence.
- Every supplied image must be fetched and cited.
- Cross-image consensus determines the sold object.
- B1 separates sold product, visible design, typography, and scene context.
- B1 returns excluded scene entities, identity candidates, confidence, and review requirement.
- Niche narrows candidate selection but cannot prove visual attributes.
- No title/description text fallback is allowed.
- If images cannot be read: `IMAGE_EVIDENCE_UNAVAILABLE`.
- If identity is materially ambiguous: `PRODUCT_IDENTITY_AMBIGUOUS` and the job becomes input/review required.

### B2 — Shopping context

- Derived only from B1 and niche.
- Audience/use-case suggestions must not become factual product claims.
- Scene-derived hints remain explicitly separated from product facts.

### B3 — Search research

- Seeds are derived from grounded B1/B2 output.
- Google Suggest is derived research, not a fourth input field.
- Search responses are untrusted evidence.

### B4 — Conflict control

- Same-store corpus identity comes from the execution envelope.
- Codex does not receive product/store identifiers.
- Existing keyword retention based on old product input is removed from generation.
- Historical performance/keyword decisions remain in benchmark/recommendation systems, not this input contract.

### B5 — Content generation

- Fact sheet contains only grounded visual facts, derived shopping context, niche, and allowed store-profile rules.
- Remove original title, original description, existing handle, variant label/summary, and existing keywords.
- Printed names/text do not prove personalization support.
- Hidden material, construction, size, care, safety, and performance claims are forbidden unless an applicable, explicitly authorized store policy supplies them.
- Handle is not a writable SEO output. Existing Review DTO compatibility may retain a display handle from the operational snapshot, but generation cannot read or change it.

### B6 — Images

- Alt text is based on grounded B1/content output only.
- Old alt text is never a fallback.
- Output filename uses a stable non-semantic identifier or generated safe label; it does not preserve/read the old handle.
- Existing image identity is preserved for Review/publish mapping through the execution envelope.

---

## 7. Team-agent operating model

Use one lead and three sub-agents. The lead owns Git state and integration. Agents must not switch branches, commit, rebase, merge, or run live queue operations.

### 7.1. Lead — Contract and Integration Owner

Owns:

- Contract freeze and architecture decisions.
- Shared/public contract files.
- Branch management, staging, commits, and handoff.
- Assignment boundaries and conflict resolution.
- Integration of agent changes.
- Live PostgreSQL/MCP/Shopify/Chrome QA.
- Final regression and acceptance report.

Primary files:

- `src/modules/seo-content/types.ts`
- `src/modules/seo-content/index.ts`
- `src/modules/custom-gpt-seo/types.ts`
- Store-profile public types/exports.
- Any shared migration/version discriminator.

Lead must not allow public contract edits by another agent after the freeze without explicit coordination.

### 7.2. Agent Core — SEO Content Core

Allowed scope:

- `src/modules/seo-content/**`
- `testing/module-seo-content/**`

Must not change:

- `gateway/**`
- `src/modules/custom-gpt-seo/types.ts`
- `src/pages/**`
- Root configuration/dependencies.

Responsibilities:

- Visual-only B1.
- Product-understanding schema and ambiguity behavior.
- Fact-sheet and claim-guard refactor.
- Jeminise store-profile generalization.
- B5/B6 legacy-field removal.
- Generation/checkpoint hash refactor.
- Module-focused tests.

### 7.3. Agent MCP — Worker and Gateway

Allowed scope:

- `gateway/seo-worker/**`
- `gateway/custom-gpt-seo/**` only where the legacy compatibility path requires it.
- Gateway worker/MCP focused test files.

Must not change:

- SEO Content core internals.
- UI/pages.
- Root dependencies.

Responsibilities:

- V2 worker context projection.
- Remove source snapshot, variants, legacy input fields, GSC context, and arbitrary instructions from queue-generation context.
- Move product identity lookup to the execution envelope.
- Tighten analysis schema and image receipt enforcement.
- V1/V2 checkpoint compatibility and migration behavior.
- Preserve leases, idempotency, recovery, store isolation, and Review delivery.
- Ensure legacy MCP cannot bypass restrictions for converted stores.

### 7.4. Agent QA — Leakage and Regression Red Team

Initial mode is read-only plus new isolated tests. It must not patch implementation unless the lead reassigns a specific failure.

Allowed test scope:

- `testing/module-seo-content/**`
- New gateway tests with unique filenames.
- Test reports under an agreed ignored/runtime location, never committed secrets.

Responsibilities:

- Baseline current behavior.
- Build forbidden-field leakage tests.
- Build hash/cache invariance tests.
- Test V1 checkpoint rejection.
- Test ambiguous/missing image behavior.
- Audit every `SeoContentInput`/`GptSeoInput` consumer.
- Run focused and full suites and route failures to the correct owner.

### 7.5. Coordination protocol

1. Lead creates one implementation branch and verifies a clean worktree.
2. QA performs baseline and consumer inventory.
3. Lead freezes contracts and publishes exact type shapes to agents.
4. Core and MCP agents work concurrently only in disjoint scopes.
5. QA adds black-box tests in separate files while implementation proceeds.
6. Lead integrates and runs typecheck before any live test.
7. Failures are routed back to the owning agent with command output and file scope.
8. Only the lead runs Jeminise Auto SEO, worker MCP, Chrome, VPS, or deployment checks.
9. Lead performs final self-review, stages only task files, and creates the focused commit.

Because agents share the same workspace, no agent may run Git branch-changing commands. Parallel work is allowed only with non-overlapping ownership.

---

## 8. Implementation phases

### Phase 0 — Safety and baseline

Deliverables:

- Clean status recorded.
- Latest `main` fetched and fast-forwarded.
- Implementation branch created.
- Dedicated PostgreSQL test database configured through `SEO_QUEUE_TEST_DATABASE_URL` or the exact test variable used by current worker tests.
- Jeminise GraphQL read succeeds.
- MCP worker endpoint/tool discovery succeeds.
- Baseline focused tests, typecheck, and builds recorded.

Stop if:

- Existing relevant tests fail and the failure cannot be clearly separated from this task.
- Test DB resolves to production/VPS database.
- Jeminise cannot be read safely.
- An active worker run or lease would collide with live QA.

### Phase 1 — Contract freeze and failing contract tests

Deliverables:

- Exact V2 types.
- Contract version constant.
- Type/runtime tests proving only three fields are accepted/projected.
- Forbidden-field projection tests.
- Execution-envelope type.
- Store-profile version/hash rules.

Required failing tests before implementation:

- `job_get_context` leaks none of the forbidden legacy fields.
- Provider/B1 spy receives no forbidden text.
- Changing original Shopify title/description/handle/variants/keywords does not change generation input hash.
- Changing image fingerprint, niche, or store-profile version changes the hash.

### Phase 2 — Store-profile generalization

Deliverables:

- General `SeoStoreProfile` contract.
- Jeminise V2 profile.
- Structured three-offering policy for Comforter, Quilt, and Duvet Cover.
- Applicability and prohibited-claim rules.
- Resolver called before enqueue, not inside generation by site domain.
- Unknown/missing profile fails closed with `STORE_PROFILE_REQUIRED`.

Migration rule:

- Old Jeminise profile remains available only through an adapter during migration.
- New jobs persist the resolved profile snapshot and `profileVersion`.
- A changed profile invalidates compatible generation checkpoints/cache.

### Phase 3 — Auto SEO and durable enqueue refactor

Deliverables:

- Auto SEO constructs only `images`, resolved `niche`, and resolved `storeProfile` for generation input.
- Product/store/source identity moves to the envelope.
- Original Shopify snapshot remains durable and inaccessible to generation context.
- Image alt is excluded from generation input.
- Input hash is split into semantic generation hash and operational/source snapshot hash.
- Queue deduplication and stale-source guards continue to work.

### Phase 4 — Canonical SEO worker MCP isolation

Deliverables:

- `job_get_context` returns only allowed semantic input, image IDs, safe schemas, and compatible checkpoints.
- `job_get_image` remains the only route to image bytes.
- Image receipt enforcement remains exact for the current lease version.
- Analysis schema includes confidence, identity candidates, excluded scene entities, and exact evidence coverage.
- GSC remains in the performance tool flow and is removed from queue-generation context.
- Worker/Agent Pack instructions no longer tell Codex to use source descriptions or variants.
- Arbitrary revision instructions are not exposed as generation input.
- Legacy endpoint is blocked or projected through the same V2 restriction for converted stores.

### Phase 5 — SEO Content core refactor

Deliverables:

- B1 takes image bytes/refs and niche only.
- Text-product-signal dependency removed from B1 evidence.
- No heuristic content generation when pixels are unavailable.
- B2–B6 consume only allowed facts.
- Existing-keyword comparator is removed from the input-driven path.
- Store profile affects policy/formatting only within its explicit applicability.
- Handle is removed from writable fields.
- Cache/checkpoint hashes use semantic input plus profile/prompt/model/pipeline versions.

### Phase 6 — Consumer and compatibility migration

Audit and update:

- Auto SEO adapters/outbox.
- Worker revision service.
- Legacy Custom GPT/Codex MCP compatibility code.
- SEO Review adapters.
- Orchestrator pipelines.
- Customization and Pinterest adapters if they still call SEO Content.
- Mocks, fixtures, queue summaries, and UI display projections.

UI display may continue to show source title/handle from the operational snapshot. That does not make them generation input.

### Phase 7 — Existing-job migration

Required behavior:

| Existing state | Migration behavior |
| --- | --- |
| `REVIEW_READY` / terminal review | Preserve immutable result and Review history. |
| `PENDING` | Rehydrate V2 input from images + resolved niche/profile; clear incompatible checkpoints. |
| `WAITING_INPUT` / `NEEDS_CHANGES` | Rehydrate V2 input; clear checkpoints that used V1 evidence. |
| `IN_PROGRESS` / leased | Drain/release safely, fence old lease, then requeue V2. |
| `VALIDATING` | Allow existing finalizer to settle or stop cutover; never reinterpret V1 checkpoints as V2. |
| Failed without valid source/profile | Keep blocked with explicit migration error. |

The migration must be idempotent, store-scoped, auditable, and tested with PostgreSQL. No automatic winning draft may be selected when duplicates conflict.

### Phase 8 — Documentation and agent pack

Update:

- Worker common instructions.
- `ffp://seo-worker/contracts` schema/version.
- Agent Pack skill and README.
- Store-profile runbook.
- Input-contract migration notes.
- QA runbook and safe cleanup procedure.

Rebuild the Agent Pack and verify its checksum only after all source changes pass tests.

---

## 9. Automated test plan

### 9.1. Contract tests

- Runtime projection contains exactly three semantic keys.
- No deprecated compatibility field is serialized to Codex.
- No index signature permits silent extra semantic fields.
- Store profile is required and versioned.
- Empty images or niche fail with stable error codes.

### 9.2. Leakage tests

Use unique sentinel strings in legacy source fields:

```text
FORBIDDEN_TITLE_SENTINEL
FORBIDDEN_DESCRIPTION_SENTINEL
FORBIDDEN_HANDLE_SENTINEL
FORBIDDEN_VARIANT_SENTINEL
FORBIDDEN_KEYWORD_SENTINEL
FORBIDDEN_ALT_SENTINEL
```

Assert none appear in:

- `job_get_context`.
- MCP structured/text content.
- Analysis prompt/provider input.
- Keyword seeds.
- B5 fact sheet.
- Generated draft caused by fallback.
- Cache semantic payload.
- Logs and error messages.

### 9.3. Image-source-of-truth tests

- Every image ID must have a receipt before analysis.
- Missing one image receipt returns `IMAGE_VIEW_REQUIRED`.
- Evidence must reference every image exactly as required by schema.
- Filename/URL/old alt changes do not change visual facts.
- Image byte/fingerprint change invalidates analysis checkpoint.
- Unreadable image produces a stable failure, not niche-only content.
- Multi-object fixture uses niche to select the correct sold product.
- Low-confidence disagreement produces `PRODUCT_IDENTITY_AMBIGUOUS`.

### 9.4. Store-profile tests

- Jeminise domain/store ID resolves the V2 profile.
- Profile version changes invalidate generation checkpoints.
- Jeminise rules produce the required three-offering section only when applicability passes.
- A blanket-like image outside the configured applicability does not inherit three-style claims.
- Another store cannot receive Jeminise rules.
- Missing/unknown profile fails closed.
- Store profile cannot add unsupported visual motifs or typography.

### 9.5. Persistence and concurrency tests

- Generation hash and source snapshot hash are distinct.
- Same semantic input plus different old content yields the same generation hash.
- Same product identity still deduplicates operationally.
- Two workers cannot claim the same product.
- Stale leases cannot save checkpoints.
- V1 checkpoint cannot resume in V2.
- Store isolation remains intact.
- Retry/idempotency keys remain stable.
- Review delivery is exactly once.

### 9.6. Worker MCP lifecycle test

Run the entire code-based flow:

```text
worker_status
→ worker_select_store (when required)
→ worker_register
→ queue_status
→ run_start(target=1)
→ queue_claim_next
→ job_get_context
→ job_get_image for every imageId
→ job_save_analysis
→ job_research_keywords
→ job_choose_keywords
→ job_submit_draft
→ job_status / run_status
→ REVIEW_READY
→ run_finish / worker_finish
```

Assertions:

- Context has no forbidden fields.
- The selected store is Jeminise.
- Every image is fetched.
- Analysis and submission satisfy schemas.
- No approve/publish tool exists in the worker MCP.
- No Shopify mutation occurs.

### 9.7. Focused commands

Run the narrowest relevant command after every implementation change. Expected commands include:

```powershell
node node_modules/tsx/dist/cli.mjs --test gateway/__tests__/seo-worker-*.test.ts
node node_modules/tsx/dist/cli.mjs --test gateway/__tests__/codex-seo-mcp.test.ts
node node_modules/tsx/dist/cli.mjs --test src/modules/seo-content/__tests__/*.test.ts
npm run typecheck:gateway
npm run typecheck
```

Use explicit file lists if shell glob behavior differs on Windows.

### 9.8. Final regression gates

These commands require fresh successful output before completion:

```powershell
npm test
npm run typecheck
npm run build
npm run build:mock
```

Because mocks, runtime composition, worker contracts, and browser-visible flows change, `build:mock` is mandatory.

---

## 10. Jeminise live QA plan

### 10.1. Preconditions

- Use the development/test Jeminise store configuration.
- Confirm read-only Shopify GraphQL access.
- Select a Jeminise product with multiple usable images.
- Confirm no active worker run/lease conflicts.
- Use a dedicated test database or isolated test schema.
- Ensure the worker token is stored through the approved vault; never expose it in chat or command arguments.
- Confirm publishing is disabled for the QA run.

### 10.2. Product selection

Prefer a product with:

- At least three product images.
- A scene containing multiple objects or bedding context.
- A visible design that is not fully described by old metadata.
- A source revision that can be safely monitored without editing the product.

Record only the product ID, job ID, run ID, profile version, image count, and redacted observations in QA evidence.

### 10.3. Auto SEO enqueue

- Pull the selected product through Auto SEO.
- Resolve niche upstream.
- Resolve and snapshot the Jeminise V2 profile.
- Enqueue one worker job.
- Verify the persisted semantic input has exactly three keys.
- Verify the operational snapshot still supports stale-source and Review behavior.

### 10.4. Worker processing

- Run one target only.
- Read context and inspect its exact keys.
- Fetch every image through MCP.
- Save grounded visual analysis.
- Perform Google Suggest research and conflict selection.
- Submit one draft.
- Poll until `REVIEW_READY` or a stable blocked state.
- Do not approve, sync, or publish.

### 10.5. Expected evidence

- MCP request/response summaries with secrets redacted.
- Proof that legacy sentinels/source fields were absent from context.
- Image receipt count equals image ID count.
- Store profile ID/version equals the resolved Jeminise profile.
- Draft claims trace to image evidence or an applicable store-profile policy.
- Review record exists exactly once.
- Shopify `updatedAt` and writable content remain unchanged during QA.

---

## 11. Chrome visual QA

Visual QA must use the user-specified Chrome surface after automated tests pass.

### 11.1. Setup

- Start the local application/gateway or use the approved staging deployment.
- Open the FFP UI in Chrome.
- Keep browser DevTools/network inspection available when needed.
- Use Jeminise as the selected store.
- Do not open or use a production publishing action.

### 11.2. Auto SEO checks

- Store selector displays Jeminise correctly.
- Product list loads through Shopify GraphQL.
- Selected product shows all expected images.
- Starting Auto SEO creates one queued worker job.
- Loading, empty, error, and success states remain usable.
- Repeated clicks do not enqueue duplicates.

### 11.3. Worker/queue checks

- Queue count updates after enqueue.
- Worker/run state is visible and consistent with backend state.
- A paused/blocked job shows a safe actionable message.
- No legacy title/description/variant data is exposed in any worker-context UI or network payload intended for generation.

### 11.4. Review checks

- The generated draft appears once in SEO Review.
- Original/source content may appear only in the Review comparison pane.
- Generated title, description, SEO metadata, AEO, and image alt fields render correctly.
- Handle is unchanged and not presented as an automatically writable SEO change.
- Jeminise store rules are visible in generated structure where applicable.
- `REVIEW_READY` does not imply approved or published.
- Approve/Sync is not clicked during this task's QA.

### 11.5. Visual evidence

Capture screenshots for:

- Jeminise product selection.
- Queued/processing state.
- Review-ready result.
- Source-versus-proposed comparison.
- Any corrected visual defect found during the loop.

Record viewport, URL, product/job ID, and timestamp. Do not capture tokens, credentials, private headers, or unredacted secret configuration.

Chrome QA fails if there is a console error caused by this change, a broken route, duplicate job, missing image, inaccessible control, layout regression preventing review, or any accidental publish behavior.

---

## 12. Fix–test–fix loop

For every failure:

1. Preserve the exact failing command, test name, error code, and relevant log excerpt.
2. Classify ownership: Contract, Core, MCP, Consumer/UI, Persistence, or Environment.
3. Route implementation failures to the owning agent.
4. Apply the smallest scoped fix.
5. Re-run the single failing test.
6. Re-run the owning focused suite.
7. Re-run typecheck for affected TypeScript projects.
8. After all focused suites pass, re-run the full regression gates.
9. After code gates pass, repeat MCP live QA.
10. After MCP QA passes, repeat Chrome visual QA.

Do not weaken schemas, disable tests, add `any`, add ignore directives, or silently fall back to legacy input to make a test pass.

Environment failures are not implementation passes. Repair the test environment or document a true external blocker; relevant acceptance tests may not be skipped.

---

## 13. Security and operational constraints

- Never print `.env.local`, bearer tokens, Shopify secrets, database passwords, or vault content.
- Use the dedicated PostgreSQL test database, never the VPS production database for destructive tests.
- VPS access is read-only until deployment is explicitly requested.
- Only the lead may perform deployment or live MCP operations.
- Live QA must stop at `REVIEW_READY`.
- Publish remains disabled; no approve/sync action is part of this task.
- Use read-only Shopify GraphQL for product selection and post-QA verification.
- Do not infer authorization to migrate or cut over production stores.
- Preserve all unrelated local changes.

---

## 14. Risk register

| Risk | Mitigation |
| --- | --- |
| Worker context still exposes source snapshot | Exact-key projection and forbidden-sentinel tests. |
| Store profile becomes a product-fact backdoor | Structured applicability plus claim-source tests. |
| Removing variants breaks Jeminise content | Encode guaranteed store policy explicitly; ambiguous applicability fails closed. |
| No pixel analyzer fallback | Use stable blocked states instead of fabricated content. |
| Existing jobs resume incompatible checkpoints | Contract versioning and mandatory V1 checkpoint invalidation. |
| Product identity loss breaks corpus/stale guard | Move identity to execution envelope and add concurrency tests. |
| Legacy MCP bypasses V2 | Block or V2-project converted stores in legacy flow. |
| GSC context becomes an accidental fourth input | Keep performance tools separate from queue-generation context. |
| Revision instructions become an accidental fourth input | Remove arbitrary instructions from generation; use versioned profile rules only. |
| UI needs old title/handle | Hydrate Review display from operational snapshot, never from generation input. |
| Duplicate live jobs | One lead, target count 1, idempotent request IDs, preflight queue status. |
| Accidental Shopify mutation | Publish disabled, no worker publish tool, read-only verification. |

---

## 15. Final review checklist

### Contract and boundaries

- [ ] Generation input has exactly `images`, `niche`, `storeProfile`.
- [ ] Execution metadata is separate.
- [ ] Store profile is versioned and mandatory.
- [ ] No forbidden legacy field reaches Codex generation.
- [ ] No cross-module internal imports were introduced.
- [ ] Public exports are intentional.

### Behavior

- [ ] Images are the source of product-specific truth.
- [ ] Niche is used only for disambiguation/framing.
- [ ] Jeminise rules work through structured profile policy.
- [ ] Ambiguous/unreadable images fail closed.
- [ ] Handle is not changed or published.
- [ ] Review source snapshot and stale guard still work.

### Persistence and migration

- [ ] Semantic and operational hashes are separate.
- [ ] V1 checkpoints cannot resume as V2.
- [ ] Queue dedupe, leases, recovery, and store isolation pass.
- [ ] Existing terminal Reviews remain intact.

### Automated verification

- [ ] Focused SEO Content tests pass.
- [ ] Worker MCP tests pass.
- [ ] PostgreSQL integration tests pass against a dedicated test database.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm run build:mock` passes.

### Live and visual verification

- [ ] Jeminise Shopify GraphQL read passes.
- [ ] Code-based worker MCP lifecycle reaches `REVIEW_READY`.
- [ ] Image receipt count matches image count.
- [ ] No Shopify write occurs.
- [ ] Chrome Auto SEO flow passes.
- [ ] Chrome Review flow passes.
- [ ] Screenshots/evidence are redacted and recorded.

### Handoff

- [ ] Diff self-reviewed for unintended files.
- [ ] Contract/environment/route changes documented.
- [ ] Migration and rollback notes documented.
- [ ] Known risks and relevant skips documented.
- [ ] Focused commit created on the task branch.

---

## 16. Required handoff format

```text
Summary
- <implemented contract and behavior>

Changed files
- <path>: <reason>

Verification
- <focused command>: <fresh result>
- npm test: <fresh result>
- npm run typecheck: <fresh result>
- npm run build: <fresh result>
- npm run build:mock: <fresh result>
- MCP Jeminise QA: <run/job/result, no secrets>
- Chrome QA: <scenarios and evidence>

Contract / environment / route changes
- <exact compatibility and migration notes>

Remaining TODOs or risks
- <none, or specific unresolved item>
```

---

## 17. Execution authorization boundary

Following this plan authorizes implementation and testing only when the user explicitly asks to begin the refactor. It does not authorize:

- Production cutover.
- Database migration on the VPS.
- Creating/revoking worker credentials.
- Approving a Review.
- Publishing or syncing to Shopify.
- Modifying GSC/GA4 configuration.

Any such action requires a separate explicit instruction.
