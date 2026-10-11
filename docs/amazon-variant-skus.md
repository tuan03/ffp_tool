# Amazon variant SKU policy

The customization-to-Shopify adapter assigns Amazon SKUs before projecting source
options to Shopify's three-option limit. Manual Review sync and Pipeline Worker
auto-sync use this same adapter. No store-specific option names or presets are
hard-coded.

- One sellable variant: `AMZ-{asin}` (unchanged).
- Multiple sellable variants with options:
  `AMZ-{asin}-{option-label}-{16-character-stable-code}`.
- A variant without options can retain `AMZ-{asin}` in a multi-variant product
  only when that ASIN is unique within that product.
- ASIN precedence remains variant `sourceAsin`, variant `asin`, product ASIN
  fallback; the family ID is never a SKU fallback. Non-Amazon merchant SKUs remain
  untouched.

Option names and values are Unicode NFC-normalized and trimmed, then names are
sorted by code unit, independent of locale or source object order. The readable
label is ASCII uppercase, accent-stripped, hyphen-separated and limited to 40
characters. Its stable code is 64-bit FNV-1a over the UTF-8 canonical JSON option
tuple, not a cryptographic/security signature. The code is always present so
adding a punctuation-colliding or long-label choice does not rename existing
multi-variant SKUs. Resulting generated SKUs stay below the internal 80-character
budget. Duplicate generated SKUs (including a theoretical hash collision) are
rejected rather than assigned order-dependent counters.

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
