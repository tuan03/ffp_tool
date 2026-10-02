# Auto SEO PostgreSQL Integration Design

## Objective

Integrate `feature/orchestrator-add-auto-seo-preprocessor` into the current Auto SEO flow without regressing smart batching, input-hash deduplication, per-store routing, Codex/Custom GPT queues, SEO Review deletion, or mock mode. Production Auto SEO backup and Auto SEO review data become PostgreSQL-backed. Shopify publishing remains outside this flow.

## Source-of-truth decision

Current `main` is the behavioral source of truth. The PostgreSQL branch contributes the storage repositories, startup bootstrap, migration utilities, and production backend-owned SEO execution. Conflict resolution must port current behavior onto PostgreSQL; it must not replace current behavior with the older branch implementation.

## Storage boundaries

- PostgreSQL owns production `auto_seo_product_backups` and Auto SEO-origin `seo_review_items`.
- The existing Custom GPT/Codex queue remains on its current queue store. Queue APIs and worker leasing are unchanged.
- SQLite Auto SEO tables remain available only for focused legacy tests and explicit migration input. Production handlers must not silently fall back to SQLite.
- Mock mode remains fully in-memory and requires no PostgreSQL connection.

## PostgreSQL backup schema

`auto_seo_product_backups` keeps the fields from the PostgreSQL branch and adds:

- `seo_input_sha256 TEXT` for normalized SEO-source identity;
- an index on `(store_id, product_id, seo_input_sha256, downstream_status)`;
- migration support for the new column and existing SQLite values.

The repository contract exposes asynchronous operations for:

- atomically classifying and inserting a submitted product batch;
- reading the latest backup state needed by eligibility preview;
- updating downstream status;
- recovering pending external-provider handoffs.

## Authoritative run transaction

For each submitted product, the server calculates the current normalized SEO input hash. PostgreSQL is authoritative at execution time:

- matching `NOT_SENT` revision → skip as `ACTIVE_DUPLICATE`;
- matching `SENT` revision → skip as `UNCHANGED`;
- matching `FAILED` revision → accept as retry;
- no matching hash → accept as new or changed.

Classification and insertion occur in one PostgreSQL transaction. Product locks are acquired in stable product-ID order so two workers submitting the same product cannot both dispatch it. Only accepted products are backed up and sent to the selected SEO provider. The response retains `acceptedProductIds`, `acceptedCount`, `skippedProducts`, and `skippedCount`.

SQLite test adapters must implement the same contract and preserve existing deterministic tests.

## Eligibility preview

`POST /api/auto-seo/eligibility` remains available. Its backup and Auto SEO review state comes from PostgreSQL; active Custom GPT/Codex queue state continues to come from the queue service.

States remain:

- `never_processed`;
- `changed`;
- `retry`;
- `current`;
- `active`.

Preview is advisory. The authoritative run transaction always rechecks the hash before dispatch.

## SEO Review behavior

Gemini outputs are saved by the backend to PostgreSQL and linked to the exact backup through `backup_id`. Auto SEO review endpoints support list, read, edit, status changes, and delete. Delete is a soft delete consistent with the current Review behavior and must not modify Shopify synchronization audit records.

Non-Auto-SEO review sources retain their current storage and behavior. Routing by source must not hide Pinterest, crawler, or existing queue-origin review items.

## Gateway startup and recovery

Production startup performs PostgreSQL schema initialization and verification before listening. Startup fails closed when the required database is unavailable or invalid.

The gateway exposes both:

- `POST /api/auto-seo/run`;
- `POST /api/auto-seo/eligibility`.

The external-provider outbox recovery reads pending Auto SEO backups through the PostgreSQL repository. A recovery failure is isolated so Custom GPT/Codex queue processing continues and reports a safe diagnostic.

## Client behavior

Production passes `backendRunsSeo=true` to the Auto SEO page. After `/api/auto-seo/run` succeeds:

- Custom GPT and Codex navigate to the selected store's SEO Queue;
- Gemini navigates to the selected store's SEO Review;
- the browser does not execute SEO a second time;
- notifications use accepted/skipped server counts;
- eligibility preview refreshes after the run.

Mock mode passes `backendRunsSeo=false` and keeps its current local simulation.

The smart controls from `main` remain unchanged: batch sizes `10/20/50/100`, default `50`, needs-SEO filtering, localized badges, and deterministic priority selection.

## Migration and compatibility

Migration copies legacy SQLite backup and Auto SEO review rows to PostgreSQL, including input hashes where present. Legacy rows without an input hash remain conservative and are classified as changed until a new successful hashed run establishes a baseline.

Environment and deployment configuration add server-only `AUTO_SEO_DATABASE_URL`. Browser-exposed variables must never contain database credentials. Docker production installs runtime TypeScript execution dependencies needed by the server and starts only after PostgreSQL readiness.

## Verification

Focused tests must cover:

- atomic concurrent duplicate submissions against the PostgreSQL repository;
- unchanged, changed, failed/retry, and mixed batches;
- PostgreSQL eligibility plus active queue/review states;
- schema bootstrap and legacy migration, including `seo_input_sha256`;
- backend-owned production SEO without a second browser execution;
- correct store routing and accepted/skipped notifications;
- Auto SEO Review soft deletion without Shopify publication or audit deletion;
- outbox recovery with current provider/store queue behavior;
- mock mode without PostgreSQL or network access.

Final verification requires `npm test`, `npm run typecheck`, `npm run build`, and `npm run build:mock`.

## Non-goals

- Moving the Custom GPT/Codex lease queue to PostgreSQL.
- Publishing approved reviews to Shopify as part of Auto SEO execution.
- Redesigning the current Auto SEO interface.
- Removing legacy migration inputs before production data has been verified.
