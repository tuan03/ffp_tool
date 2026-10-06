# SEO versioning domain

This folder owns the authoritative product SEO version ledger described by
`todo/README_FFP_SEO_VERSIONING_TEAM_PLAN.md`.

## Frozen V1 decisions

- PostgreSQL is authoritative. Shopify `custom.seo_version` is only a remote
  mirror and write fence; a mismatch blocks publishing for reconciliation.
- A product is identified by `(store_id, shopify_product_gid)`.
- Snapshot schema V1 and field-set V1 cover title, description HTML, SEO title,
  SEO description, image alt text keyed by Media GID, and the AEO metafields
  that the durable publisher actually mutates.
- Canonical hashes use deterministic JSON, LF line endings, Media GID ordering,
  and preserve the distinction between `null` and an empty string. Catalog
  context such as handle, URL, tags, price, inventory and status is evidence,
  not writable versioned content.
- Any verified change in the V1 field set creates the next product SEO version.
  `NO_CHANGE` creates an audit receipt only and performs no Shopify write.
- `public_effective_at` remains null unless public visibility is verified.
- External edits create observed snapshots and dirty intervals without changing
  the committed version number or mutating a committed snapshot.
- Rollback is a new approved forward publish with `source=ROLLBACK`; version
  numbers never move backward.
- Versioning read/write availability is store-scoped and disabled by default.
  The existing `SEO_WORKER_PUBLISH_ENABLED` flag remains the global write kill
  switch.
- Jeminise is the READ-only pilot. No real Shopify mutation is authorized by
  this implementation task.

## Compatibility and cutover

The existing `seo_publish_operations` table remains the durable remote-write
state machine. `seo_publish_versions` remains an exactly-once compatibility
receipt and links to the authoritative `seo_versions` row.

For a store with versioning write enabled, the backend publisher is the only
version allocator and Shopify writer. The legacy browser/orchestrator sync path
must fail closed with `BACKEND_PUBLISH_REQUIRED`; it must not calculate or write
an independent SEO version. Stores that have not been cut over keep their
existing behavior while the new versioning write flag is disabled.

Migrations are additive. Disabling the feature stops new baselines and writes
but keeps all product, snapshot, version, drift and audit records readable.
