# Approved AEO publishing

Crawler and Auto SEO publications use the public `shopify-sync` AEO builder.
The publisher derives HTML only from the approved summary and FAQ, escapes
their text, and validates that JSON-LD contains the Schema.org `Product` and
`FAQPage` nodes. It does not rerun a model or append AEO to the product description.

## Shopify fields

- `custom.aeo_suite_html`: HTML stored as `multi_line_text_field`.
- `custom.aeo_json_ld`: validated structured data stored as `json`.
- Auto SEO also preserves `custom.aeo_quick_summary` and `custom.aeo_faq`
  for existing integrations.

Both managed definitions are ensured in the execution store before a product
update. Existing definitions are reused; a type conflict blocks the update
without deleting or replacing the definition. Preview never creates definitions.
Storefront/theme rendering remains outside this change.

## Publication safety and compatibility

The durable operation freezes the approved AEO values with the other SEO fields.
Read-back must match every intended metafield before publication succeeds.
Lost responses use the existing reconciliation path rather than another write.
Versioned snapshots now read AEO HTML too, so edits are detected and forward
rollback publications retain the historical AEO fields.

A missing HTML metafield (both type and value null) is omitted from the canonical
snapshot to preserve pre-existing hashes for products that never had it. Present
values, including empty strings, participate in the hash. Historical records are
not rewritten. Products with independently added HTML may need the existing
baseline observation/reconciliation flow before publishing.

Reviews with no AEO fields remain compatible. A review with only some AEO fields,
an empty summary/FAQ, or incomplete JSON-LD fails before enqueueing with
`INVALID_AEO_FIELDS`. Correct and approve the review instead of silently omitting
its AEO content. Existing queued operations retain their original frozen fields;
this change does not mutate operations that may already have written Shopify.

## Existing synced products

Deployment does not automatically backfill already-synced products. The six
previously confirmed `preaureum_real` publications require a scoped maintenance
operation after deployment. No Codex rerun is needed:

1. Use an explicit approved job/product allowlist, never a store-wide update.
2. Verify the approved review, original successful receipt, current Shopify
   content and absence of an active worker/publish claim. Preserve an audit backup.
3. Generate HTML from the approved summary/FAQ. Skip products with identical HTML;
   stop on a differing existing value or other content drift for operator review.
4. Write only the missing AEO HTML using the current live revision guard. Do not
   requeue the completed operation or overwrite product text, media, price or SEO.
5. For stores with versioning enabled, use the authoritative versioning flow to
   record the maintenance publication; never edit an old snapshot/hash in place.
6. Read Shopify back, confirm the value/type, and record the operator audit receipt.

Do not execute this maintenance against production before the release has been
approved and deployed. New approved syncs already include both managed fields.
