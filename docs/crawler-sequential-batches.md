# Sequential crawler batches

Implemented on `cua_pro` by explicit user approval (exception to the handbook's new-branch workflow). Scope: Amazon crawler UI, public module contracts, Coordinator scheduling, mocks and tests. No production operations or Shopify writes are part of verification.

## Operator flow

Paste up to 200 unique ASINs or Amazon product URLs into the main crawl input. Select one store and shared pricing, then start once. Saved vendor/profile/image settings are snapshotted. Automatic collection/type classification remains downstream in Codex SEO. The separate filter panel remains available.

The exact Shopify metafield scan and Coordinator activity check happen before creation. Failure or incomplete verification prevents creation. Existing exact Shopify inputs are skipped without Amazon family discovery; active pipeline inputs and items requiring attention receive separate reasons. Input normalization removes exact duplicates. Invalid lines require correction.

The server persists all unique inputs, including skipped ones. Skip reasons are `existing_shopify`, `existing_pipeline`, `received`, or `attention`. Skips are completed inputs, never fabricated products or pipeline failures. Sticky progress separates input counts from product handoff counts, and per-input detail explains skips. Failed inputs can be loaded back into the input box for another verified attempt.

## Scheduling and recovery

New main-input jobs set `sequentialBatch: true`. Only one link in that batch can be leased/running/cancelling across the fleet. PostgreSQL transaction advisory locks coordinate competing scheduler processes; SQLite scheduler transactions use `BEGIN IMMEDIATE`. Legacy jobs and other channels retain their existing policy.

The first nonterminal input holds the batch, including retry backoff and outstanding final uploads. Streamed products alone do not release it. After a terminal receipt, pending inputs are checked against exact accepted product aliases and active SEO identities before dispatch. Sharing a parent is not coverage. Partial crawls therefore cannot suppress unreceived siblings. Cleared/cancelled SEO records do not permanently reserve ASINs. All checks are scoped to the selected store.

Pause/resume, cancellation, lease expiry and existing retry limits remain authoritative. An expired task is retried before later inputs, and existing lease fencing rejects stale receipts. Network ambiguity can cause repeated Amazon reads; this is not a guarantee of exactly-once network execution. The scheduling policy avoids concurrent links within the batch, not all work from unrelated systems. No waiting for SEO completion or Shopify sync is needed to advance after a crawl receipt.

## Contract and limitations

- Additive request fields: `sequentialBatch` and `batchSkippedInputs: [{asin, reason}]`. Initial skip reasons accept only Shopify, pipeline or attention; the server derives received coverage itself. At most 200 entries, each belonging to the input list.
- Additive progress fields: `batch` counters and per-input `skipReason`. Summary polling and detailed snapshots both retain counters.
- Existing `existingShopifyAsins` also protects received family products corresponding to preflight matches.
- No new route, environment variable, dependency or database migration. Existing Agent binaries can process unchanged individual assignments; only Coordinator and web need deployment.
- External Shopify membership is verified at batch start. Before each assignment the server rechecks current FFP receipts/SEO ownership, not the entire external Shopify catalog. Normal downstream duplicate checks remain in place for products discovered during crawling.
- The configured job/family timeouts still apply; sequential batches can take longer than parallel jobs. No unlimited retries or automatic destructive recovery.
- Mock batches retain their generated result in browser session state; the static mock job loader must not replace it with an unrelated historical fixture.

## Verification

Focused Python tests cover multi-agent admission, competing Coordinator instances on SQLite and PostgreSQL, partial/final receipts, retry delay, restart, pause/resume, stale leases, exact coverage, cross-store isolation, queue cleanup, active SEO appearing after preflight and all-skipped completion. PostgreSQL tests create uniquely named disposable `test_crawler_batch_*` schemas, not application records.

TypeScript tests cover preflight, fail-closed verification, input limits, request/progress contracts, mock parity and sticky counts. The opt-in browser test uses an isolated mock server to exercise paste → one Start click → skip/handoff counts → reload. It does not crawl Amazon, publish Shopify products or create production Queue entries.

### Local verification on 2026-10-18

- Focused SQLite/PostgreSQL tests: 32 passed. Coordinator/active-SEO regression run: 114 tests, 1 skipped, no failures.
- Web: 1,124 passed, 16 skipped; opt-in browser batch/reload test passed separately.
- Typecheck, mock build and real build passed. The real build was generated last before rebuilding local Docker server/client.
- Local server/client are healthy; authenticated crawler page and health endpoint returned 200, new batch controls were present, no mock badge or browser exceptions. No real crawl or Shopify write was initiated.
- Full `npm test` is not green: Gateway `McpUserManager manages users, verifies tokens, and records audit logs` failed and the Gateway test process did not terminate. Full engine run: 756 tests, 36 skipped, one failure in `test_double_clicked_packaged_agent_uses_config_beside_executable` because the machine's saved connection config was selected instead of its temporary portable fixture. Those unrelated code paths were not changed; user configuration was preserved.
- No push, VPS deployment or Agent release was performed.
