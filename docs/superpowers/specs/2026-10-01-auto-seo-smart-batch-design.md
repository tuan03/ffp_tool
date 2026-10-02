# Auto SEO Smart Batch Selection Design

**Date:** 2026-10-01  
**Status:** Approved conversational design; pending written-spec review

## 1. Goal

Make Auto SEO practical for stores with hundreds or thousands of products. The operator should not have to inspect and manually select every product, and the system must not generate duplicate SEO work for unchanged source content.

Success means:

- the operator can select the next 10, 20, 50, or 100 eligible products with one action;
- products never sent to SEO are handled before products that need reprocessing;
- a previously processed product becomes eligible again when its SEO input changes;
- unchanged products and same-input work already in Queue or Review are skipped;
- the operator can inspect the selection before pressing **Run Auto SEO**;
- all decisions are scoped by `storeId`;
- this flow never publishes directly to Shopify.

## 2. User experience

The Auto SEO toolbar gains:

- a batch-size selector with `10`, `20`, `50`, and `100`; default `50`;
- a **Select next N products** action;
- an eligibility filter with at least **Needs SEO** and **All products**;
- a compact count summary for never processed, changed, already current, and currently active products.

Selecting the next batch does not start SEO. It replaces the current selection with the first eligible products in this order:

1. products never successfully dispatched to SEO;
2. products whose current Shopify `updatedAt` is newer than their last successful SEO dispatch;
3. within each group, most recently updated first;
4. use product ID as a stable final tie-breaker.

The existing **Run Auto SEO** button remains the explicit execution step. Manual search, filtering, and individual selection continue to work.

The UI uses these product states:

| State | Meaning | Automatically eligible |
| --- | --- | --- |
| `never_processed` | No successful SEO dispatch exists for this store and product | Yes |
| `changed` | Shopify indicates a later update than the last successful dispatch | Yes |
| `current` | The latest authoritative SEO input hash matches the last successful dispatch | No |
| `active` | The same authoritative input is already queued, processing, or awaiting review | No |
| `retry` | The last dispatch failed and no equivalent active work exists | Yes |

The list-level state is a fast preview. The server makes the final decision when the operator runs the selected batch.

## 3. Recommended architecture

Use a two-stage eligibility check.

### Stage A: inexpensive list classification

After Shopify products are loaded, the client sends only product identity and list metadata to an Auto SEO eligibility endpoint:

- `storeId`;
- product ID;
- Shopify `updatedAt`.

The gateway compares those values with the latest successful Auto SEO dispatch for the same `(storeId, productId)` and with active Queue/Review work. It returns one lightweight state per product. This avoids fetching complete detail for all 1,000 products simply to render the page.

`updatedAt` is only a candidate detector. It must not be treated as proof that SEO-relevant content changed because Shopify may update inventory or other unrelated fields.

### Stage B: authoritative run check

When **Run Auto SEO** is pressed, the client hydrates only the selected product details using the existing bounded-concurrency path. The gateway creates the normalized payload that would actually be handed to the SEO provider, canonicalizes it, and computes its SHA-256 `inputHash`.

The authoritative hash includes the grounded source fields exposed to the SEO generator, including title, handle, description, existing SEO metadata, product facts, and normalized image data. Ordering-sensitive collections are normalized before hashing so semantically identical input produces the same hash. Volatile transport-only values are excluded.

For each selected product, atomically:

- no prior successful hash: accept it;
- prior successful hash differs: accept it as a new SEO revision;
- prior successful hash matches: skip it as unchanged;
- identical active work exists: skip it as a duplicate;
- a newer hash supersedes older unapproved Queue work using the existing queue supersession behavior.

Only accepted products are backed up and dispatched. A mixed request may therefore process some products and skip others.

## 4. Persistence

Keep `snapshot_sha256` as the full backup/audit checksum. Add a separate nullable `seo_input_sha256` column to `auto_seo_product_backups`; these hashes have different meanings and must not be conflated.

- `snapshot_sha256`: integrity checksum of the complete stored Shopify snapshot.
- `seo_input_sha256`: stable checksum of the normalized source payload used for SEO deduplication.

Existing rows remain valid after migration. A legacy row without `seo_input_sha256` can support the fast `updatedAt` preview, but the next selected run is treated as requiring an authoritative comparison/backfill rather than being declared current without evidence.

The latest successfully dispatched row (`downstream_status = 'SENT'`) is the comparison baseline. Failed and unsent rows do not make a product current. Queries and indexes remain scoped by `(store_id, product_id)`.

## 5. API contracts

Add a read-only eligibility operation to the Auto SEO client contract. Its request contains `storeId` and product summaries; its response contains product ID, eligibility state, last successful Shopify timestamp when available, and a safe reason code.

Extend the existing Auto SEO run response with:

- accepted product IDs/count;
- skipped product IDs/count;
- a reason per skipped product, such as `UNCHANGED` or `ACTIVE_DUPLICATE`.

The endpoint must validate store/product identifiers, reject duplicate product IDs in a request, cap the number of summaries accepted in one call, and never expose stored snapshots or hashes to the browser unless needed for diagnostics. The server remains authoritative even if the browser sends stale eligibility data.

Existing callers remain compatible: current response fields are preserved and new fields are additive. Mock and real clients implement the same public contract.

## 6. Data flow

```text
Load Shopify products
        |
        v
Eligibility preview (ID + updatedAt only)
        |
        v
Select next N: never_processed -> changed/retry -> newest first
        |
        v
Operator reviews selection and presses Run Auto SEO
        |
        v
Hydrate selected product details
        |
        v
Gateway computes authoritative seo_input_sha256
        |
        +--> unchanged / identical active work: skip with reason
        |
        +--> new / changed / retry: backup and dispatch
                                      |
                                      +--> Codex or Custom GPT: SEO Queue
                                      +--> Gemini: SEO Review
```

Queue jobs and Review records retain the selected `storeId`, so results continue to appear under the correct store. This design does not alter Shopify publishing; publication remains a separate human-approved action in SEO Review.

## 7. Error and concurrency behavior

- If eligibility preview fails, the product table still loads and manual selection remains available. The smart selection action shows a retryable error instead of guessing.
- If hydration fails for one selected product, the run reports that product clearly and does not silently substitute stale cached detail.
- Hash comparison and acceptance happen inside a server transaction so two clients submitting the same product and input concurrently cannot create duplicate accepted work.
- Queue-level unique deduplication remains the second line of defense.
- A partial run reports accepted and skipped products separately.
- Store changes clear selection and eligibility state before loading the new store.

## 8. Scope and expected code areas

Expected changes are limited to:

- `src/modules/auto-seo/`: public eligibility/run contracts, mock parity, toolbar/filter UI, selection state, focused tests;
- `src/modules/orchestrator/auto-seo-module-api-client.ts`: real API methods and response validation;
- `gateway/auto-seo-db.ts`: additive schema migration and lookup/index support;
- `gateway/auto-seo-handler.ts` and gateway routing: preview and authoritative filtering;
- a small gateway-only normalizer/hash helper shared by Auto SEO run and its tests;
- gateway and module tests for eligibility, hash stability, deduplication, concurrency, store isolation, and UI selection.

No dependency, route path, Shopify credential, provider configuration, or automatic publishing change is required.

## 9. Testing and acceptance criteria

Focused tests must prove:

- never-processed products rank before changed/retry products;
- the newest `updatedAt` sorts first within a priority group;
- selection stops at the chosen batch size;
- switching stores cannot reuse another store's eligibility or selection;
- an unchanged normalized payload is skipped even when Shopify `updatedAt` changed;
- a changed normalized payload creates a new revision;
- two concurrent identical submissions result in one accepted SEO job;
- identical active Queue/Review work is not duplicated;
- legacy rows without the new hash migrate safely;
- mock and real Auto SEO clients satisfy the same contract;
- no path added by this feature publishes to Shopify.

Before handoff, run:

```bash
npm test
npm run typecheck
npm run build
npm run build:mock
```

## 10. Deliberate non-goals

- Do not automatically run SEO immediately after selecting a batch.
- Do not fetch and hash full details for every product on initial page load.
- Do not process all products in one unbounded request.
- Do not automatically publish approved content to Shopify.
- Do not add background scheduling in this change.
