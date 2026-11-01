# Etsy crawler integration

## Flow and boundaries

Distributed Crawler supports Amazon (default) and Etsy. Select Etsy, one store,
and up to 200 listing URLs or numeric listing IDs. FFP checks exact Etsy identity
against Shopify and the current Queue/Review state before creating work. The
separate filter panel keeps its input/results per store; **Crawl** replaces the
main input without starting work. Etsy listings do not use Amazon family logic.

Coordinator obtains the API baseline. Windows Agent 5.3.10 or newer advertises
the `etsy` capability and verifies missing inventory/displayed USD prices in a
separate Etsy browser context. Old Agents remain eligible for Amazon only.
Credentials stay on the Coordinator; they never appear in tasks or Agent ZIPs.

One Etsy listing produces one product with the observed purchasable combinations.
Sold-out/digital choices are excluded. Amazon/Jeminise/Preaureum replacement
variants never apply to Etsy, including when using those stores' saved defaults.
Vendor, image processing and explicit pricing settings still apply.

The pipeline uses `etsy:<listingId>`, distinct Etsy product/variant metafields,
and `ETSY-` SKUs. Amazon ASIN/parent fields are not filled with Etsy IDs.
SEO Queue passes source evidence to Codex for SEO and classification, then uses
the existing automatic sync setting. SEO Review remains available for monitoring
and corrections. Missing price/inventory evidence or unmapped required
personalization blocks sync; it must not publish guessed data.

### Etsy personalization variants

At sync preparation, independent dropdown questions are expanded into native
Shopify options on each purchasable source variant. Text and upload fields remain
in Customizer. Raw crawl/SEO snapshots stay unchanged. New product syncs use the
new shape; completed historical syncs remain protected by their existing write
fence. Reopening completed syncs for migration is deferred. Reconciliation of an
uncertain partial write remains available without rerunning SEO.
An 8-size listing with 6 colors and 6 skin tones produces 288 variants, each with
a stable `ETSY-{listingId}-{shortCode}` SKU and its original `etsy_product_id`.
The projection is idempotent and included in the sync checksum.

The read operation `products.variantLimits` returns the selected store's
`maxProductOptions` and `maxProductVariants`. Over-limit combinations, duplicate
axes, dependent questions, missing values and dropdown surcharges block sync;
they do not silently revert to Customizer. Optional dropdowns include a
`No personalization` choice. The current projector supports up to 3 axes and
2048 combinations, then checks the shop's actual limits before any write.

Sync/reconciliation reads all variant pages, writes batches of at most 250,
and matches expanded Etsy variants by SKU (legacy source SKU on first migration),
not array position. Partial writes retain their product mapping and an incomplete
checksum. Converted dropdowns disappear from Customizer only after variant sync;
when no freeform fields remain, the old Customizer metafield is removed.
SEO Review shows the projected count and option names before sync. Theme support
for high-variant products must be checked on the target storefront after an
operator-authorized sync; local data tests do not prove storefront behavior.

Variant metafield writes use an owner-specific idempotency key under the sync
request prefix. Retrying the same variant reuses its key; different variants
must not share a key for `custom.etsy_product_id`. Product-level keys are unchanged.
If an older sync stopped after creating the Shopify product, keep its checkpoint
and use **Kiểm tra trạng thái Shopify** in SEO Review after deploying the fix.
The reconciliation resolves the stored Shopify product and resumes an update;
do not delete the mapping or rerun SEO to recover this partial write.

## Coordinator configuration

Set a private, persistent random `FFP_ETSY_TOKEN_ENCRYPTION_KEY` on the server.
The database stores only encrypted credential values. Preserve this key with the
database backup; changing it prevents decryption. Never use a `VITE_` variable.

Set `ETSY_TOKEN_ENVIRONMENT=local` for local testing, or `vps` on production.
Only the credential's owning environment may refresh its OAuth grant.
`ETSY_TOKEN_REFRESH_ENABLED=false` disables refresh on a non-owning node.

Open **Etsy > Connection** in the crawler (uses the existing Coordinator operator
authorization policy; explicitly public local mode remains public),
enter API keystring, shared secret, access token and refresh token once, and
save. Empty fields retain existing values. The connection check verifies the
API key and can refresh an expired token; listing inventory access is also
checked when crawling. A successful public API ping alone does not prove
inventory permission for every listing.

Optional first-start import variables are documented in `.env.example`.
Import only runs when the database vault is empty, so an old deployment secret
cannot replace rotated tokens. Prefer the credential form after initial setup.

### Moving from the legacy tool

1. Stop the legacy tool's Etsy OAuth refresh before importing its credentials.
2. Import once into the owning FFP Coordinator. Do not run independent local
   and VPS refreshers against copies of the same grant.
3. Verify refresh and a real listing on the owning environment. A rejected
   refresh token requires renewed authorization; do not repeatedly retry it.
4. If moving local to VPS later, stop local refresh first and transfer the
   current credentials securely, not stale values from the legacy `.env`.

## Compatibility and rollout

Database migration 17 adds Etsy credential storage and allows Etsy tasks without
an Amazon ASIN. PostgreSQL updates in place. SQLite rebuilds the task table with
foreign keys suspended outside the migration transaction, validates references,
and restores enforcement. Existing Amazon task children are retained.

New operator endpoints: `/api/v1/etsy-listings/resolve`,
`/api/v1/etsy-listings/activity`, `/api/v1/etsy/auth/status`,
`/api/v1/etsy/auth/credentials`, `/api/v1/etsy/auth/test`.
Agent baseline endpoint requires an authenticated, current task lease:
`/api/v1/worker/tasks/{taskId}/etsy-baseline`.
Shopify Gateway adds `products.preflightEtsyListings`.

Build/restart both local server and client, then use the new Agent package.
Updating web code alone does not add Etsy support to an already running EXE.
Use the regenerated SEO worker pack for Etsy-specific source/classification
instructions. Publishing an Agent release, pushing main or deploying VPS is a
separate operation.

## Verification

Focused coverage includes encrypted credentials and refresh ownership, refresh
coalescing, rate limits, SQLite child-row retention, exact variants and missing
evidence blockers, personalization, Agent outbox, deduplication and recrawl after
Queue clear, paginated Shopify preflight, SEO context and Shopify source mapping.

Run the optional browser test against mock mode using
`FFP_CRAWLER_UI_TEST_URL=http://127.0.0.1:5199` and
`FFP_CRAWLER_UI_BROWSER_CHANNEL=chrome`. The browser test checks source drafts,
filter persistence, Crawl replacement and mobile width without Shopify writes.

### Local acceptance check (2026-11-01)

- Docker local server/client are rebuilt and healthy on port 3011; database
  backup is `.runtime/ffp-before-etsy.dump`.
- Legacy credentials were imported once into the local encrypted vault and
  refreshed successfully. The owning environment is `local`. Do not resume
  the legacy refresher using the same OAuth grant.
- Listing `4570662279` returned nine available choices (eight adult shirt
  sizes and `Gift Card only`) and two required dropdowns. The product adapter
  preserves those choices, generates nine distinct Etsy SKUs, and applies no
  Amazon preset. API evidence is complete; conversion has no sync blockers.
- A separate headless browser probe encountered Etsy CAPTCHA and returned the
  explicit manual-verification error. This listing does not require browser
  fallback because its API evidence is complete. Browser fallback must still be
  tested with an operator when CAPTCHA occurs; automated bypass is not provided.
- No test product was enqueued, generated through a live Codex session, or
  written to Shopify. Those stages have mocked integration coverage; their live
  acceptance remains an operator test.
- Windows Agent 5.3.10 EXE passes the isolated offline startup/identity probe.
  `.runtime/etsy-agent/FFP-Amazon-Crawler-5.3.10-local-test.zip` is a manual-test
  package, not a signed published update-channel release.
- Python: 797 tests run, 39 skipped, no failures (isolated LOCALAPPDATA).
  Web: 1,151 passed, 17 skipped with test concurrency limited to two.
  Focused TypeScript Etsy/status tests: 25 passed; browser workflow: passed.
  Typecheck, production build, mock build and Docker build passed.
- `npm test` cannot be marked fully passing: Gateway leaves open handles.
  A bounded run also exposes three failing Ads Intelligence assertions in
  `ads-intelligence-mcp.test.ts` and `ads-intelligence-reconciliation.test.ts`,
  reproduced separately. Memory failures from running Gateway files concurrently
  were rerun separately (29 tests passed). Review Image and Pinterest suites pass.

No commit, push, VPS deployment, production Agent replacement or release publish
was performed during this local acceptance check.
