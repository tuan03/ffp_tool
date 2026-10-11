# Amazon variant SKU policy

The customization-to-Shopify adapter assigns Amazon SKUs before projecting source
options to Shopify's three-option limit. Manual Review sync and Pipeline Worker
auto-sync use this same adapter. No store-specific option names or presets are
hard-coded.

- One sellable variant: `AMZ-{asin}` (unchanged).
- Multiple sellable variants with options:
  `AMZ-{asin}-{8-character-stable-code}`, normally 23 characters total.
- A variant without options can retain `AMZ-{asin}` in a multi-variant product
  only when that ASIN is unique within that product.
- ASIN precedence remains variant `sourceAsin`, variant `asin`, product ASIN
  fallback; the family ID is never a SKU fallback. Non-Amazon merchant SKUs remain
  untouched.

Option names and values are Unicode NFC-normalized and trimmed, then names are
sorted by code unit, independent of locale or source object order. The stable
code is the first eight uppercase hexadecimal characters of 64-bit FNV-1a over
the UTF-8 canonical JSON option tuple, not a random ID or security signature.
Option labels are not included in the SKU. When different variants sharing an
ASIN have the same eight-character prefix, only the affected codes expand to
12, then 16 characters as needed. This is resolved across the complete batch,
independent of variant order; unrelated SKUs remain unchanged. Adding a new
short-code collision can lengthen an existing colliding code. No inventory
backfill or persistent code allocation is performed. Duplicate identities or
full-digest collisions fail before a Shopify write instead of receiving random
or order-dependent counters. Generated SKUs are at most 31 characters long.

Prices, image URLs, title, variant list position and store identity do not enter
the signature. Same ASIN and options in separate stores produce the same SKU.
Changing an option's identity changes its SKU. Transitioning a product from one
variant to multiple variants replaces its former base-only SKU with a suffix.

Missing or ambiguous selections in variants sharing an ASIN cause
`AMAZON_VARIANT_SKU_INVALID` before a Shopify write. The operator must correct the
variant data; the adapter never manufactures random identifiers to hide missing
identity. Original options, customization, prices, images and ASIN metafields are
not changed by SKU generation.

This change affects subsequent create/update sync payloads; it does not migrate
existing Shopify inventory. Existing products receive the new SKU only when
explicitly synced/updated through the relevant workflow. The Pipeline Worker's
checkpoint signature already includes `variantSkus`, so changed SKU payloads
cannot incorrectly reuse an earlier SKU checkpoint. Existing in-flight sync
operations must still be reconciled; SKU changes do not bypass write fencing.

Focused tests:

```powershell
node --import tsx --test src/modules/shopify-sync/__tests__/adapter-sku.test.ts src/modules/shopify-sync/__tests__/variant-sku.test.ts
```

No dependencies, routes, environment settings or public transport contracts were
added or changed.
