import assert from "node:assert/strict";
import test from "node:test";

import type { CrawlProduct } from "../../customization-normalizer";
import {
  fromCustomizationNormalizerProduct,
  prepareShopifySyncProduct,
  syncSingleProduct,
  type SetMetafieldInput,
  type ShopifyGateway,
} from "../index";

const listingId = "1789456123";

test("Etsy variant SKUs follow ETSY-{listingId}-{shortCode}, stay order-independent, and expand on collision", () => {
  const first = fromCustomizationNormalizerProduct(
    {
      sourcePlatform: "etsy",
      sourceProductId: listingId,
      canonicalUrl: `https://www.etsy.com/listing/${listingId}/personalized-mug`,
      variants: [
        { price: 18.5, sourceVariantId: "99001122", options: { Size: "11oz", Color: "White" } },
        { price: 22.0, sourceVariantId: "99001123", options: { Size: "15oz", Color: "Black" } },
      ],
    },
    { vendor: "Store A" },
  );

  const reordered = fromCustomizationNormalizerProduct(
    {
      sourcePlatform: "etsy",
      sourceProductId: listingId,
      title: "Renamed Title",
      variants: [
        { price: 40.0, sourceVariantId: "99001123", options: { Color: "Black", Size: "15oz" } },
        { price: 35.0, sourceVariantId: "99001122", options: { Color: "White", Size: "11oz" } },
      ],
    },
    { vendor: "Store B" },
  );

  assert.equal(first.variants?.[0]?.sku, reordered.variants?.[1]?.sku);
  assert.equal(first.variants?.[1]?.sku, reordered.variants?.[0]?.sku);
  assert.match(first.variants?.[0]?.sku ?? "", /^ETSY-1789456123-[A-F0-9]{8}$/);
  assert.equal(first.variants?.[0]?.price, "18.50");
  assert.equal(first.variants?.[1]?.price, "22.00");
  assert.equal(first.amazonAsin, undefined);
  assert.ok(!(first.tags ?? []).some((tag) => tag.startsWith("asin:")));

  // Verify [8, 12, 16] collision expansion using known 8-hex-colliding option tuples
  const colliding = fromCustomizationNormalizerProduct({
    sourcePlatform: "etsy",
    sourceProductId: listingId,
    variants: ["Choice 65742", "Choice 89622", "Unrelated"].map((Size) => ({
      price: 19.99,
      options: { Size },
    })),
  });
  assert.equal(colliding.variants?.[0]?.sku, `ETSY-${listingId}-F373E889E079`);
  assert.equal(colliding.variants?.[1]?.sku, `ETSY-${listingId}-F373E8895711`);
  assert.match(colliding.variants?.[2]?.sku ?? "", new RegExp(`^ETSY-${listingId}-[A-F0-9]{8}$`));

  assert.throws(
    () =>
      fromCustomizationNormalizerProduct({
        sourcePlatform: "etsy",
        sourceProductId: listingId,
        variants: [
          { price: 15, options: { Size: "M" } },
          { price: 18, options: { Size: "M" } },
        ],
      }),
    /ETSY_VARIANT_SKU_INVALID/,
  );
});

test("Etsy sync writes Etsy product + variant metafields and customizer upload fields without Amazon leakage", async () => {
  const metafieldCalls: SetMetafieldInput[] = [];
  let createdTags: readonly string[] = [];

  const crawlProduct: CrawlProduct = {
    id: `etsy-${listingId}`,
    sourcePlatform: "etsy",
    sourceProductId: listingId,
    canonicalUrl: `https://www.etsy.com/listing/${listingId}/custom-portrait-blanket`,
    title: "Custom Pet Portrait Blanket",
    descriptionHtml: "<p>Soft custom pet blanket</p>",
    customizerAuditStatus: "verified_custom",
    media: [{ url: "https://i.etsystatic.com/12345/r/il/abc123/654321/il_fullxfull.654321_abcd.jpg" }],
    variants: [
      {
        price: 29.95,
        sourceVariantId: "77001101",
        options: { Size: "30x40 in", Material: "Fleece" },
      },
      {
        price: 44.95,
        sourceVariantId: "77001102",
        options: { Size: "50x60 in", Material: "Sherpa" },
      },
    ],
    customization: {
      hasCustomization: true,
      textInputs: [
        {
          id: "etsy_q_1",
          name: "Pet Name",
          label: "Pet Name",
          required: true,
          maxLength: 40,
          instructions: "Enter your pet name exactly as desired.",
        },
      ],
      imageInputs: [
        {
          id: "etsy_q_2",
          name: "Pet Photo",
          label: "Upload Pet Photo",
          required: true,
          maxFiles: 2,
          instructions: "Clear front-facing photo.",
        },
      ],
      controlOrder: ["etsy_q_1", "etsy_q_2"],
      rawConfig: {
        schemaVersion: 1,
      },
    },
  };

  const syncInput = {
    ...fromCustomizationNormalizerProduct(crawlProduct, { vendor: "Jeminise" }),
    sourceKey: `etsy:${listingId}`,
  };

  const gateway: ShopifyGateway = {
    async createProduct(input) {
      createdTags = input.tags ?? [];
      return {
        productId: "gid://shopify/Product/5001",
        productHandle: "custom-pet-portrait-blanket",
        createdVariantsCount: input.variants?.length ?? 0,
        variants: (input.variants ?? []).map((variant, index) => ({
          id: `gid://shopify/ProductVariant/800${index + 1}`,
          sku: variant.sku,
        })),
      };
    },
    async createVariants() {
      return { createdCount: 0, variantIds: [] };
    },
    async uploadFile(input) {
      return {
        fileId: "gid://shopify/MediaImage/1",
        shopifyCdnUrl: `https://cdn.shopify.com/s/files/${input.filename}`,
      };
    },
    async setProductMetafield(input) {
      metafieldCalls.push(input);
      return { success: true, metafieldId: `gid://shopify/Metafield/${metafieldCalls.length}` };
    },
    async deleteProductMetafield() {
      return { success: true };
    },
  };

  const result = await syncSingleProduct(syncInput, { gateway });
  assert.equal(result.success, true);
  assert.equal(result.variantsCount, 2);

  // Must carry ffp-source:etsy:{listingId} and zero asin:* tags
  assert.ok(createdTags.includes(`ffp-source:etsy:${listingId}`));
  assert.ok(!createdTags.some((tag) => tag.startsWith("asin:")));

  const keys = metafieldCalls.map((call) => ({
    key: call.key,
    ownerId: call.ownerId ?? null,
    value: call.key === "amazon_customizer" ? "json" : call.value,
  }));

  assert.deepEqual(keys, [
    { key: "amazon_customizer", ownerId: null, value: "json" },
    { key: "audit_status", ownerId: null, value: "verified_custom" },
    { key: "etsy_listing_id", ownerId: null, value: listingId },
    {
      key: "etsy_listing_url",
      ownerId: null,
      value: `https://www.etsy.com/listing/${listingId}/custom-portrait-blanket`,
    },
    { key: "etsy_product_id", ownerId: "gid://shopify/ProductVariant/8001", value: "77001101" },
    { key: "etsy_product_id", ownerId: "gid://shopify/ProductVariant/8002", value: "77001102" },
    {
      key: "ffp_source_key",
      ownerId: null,
      value: JSON.stringify({ sourceKey: `etsy:${listingId}` }),
    },
  ]);

  const customizerCall = metafieldCalls.find((call) => call.key === "amazon_customizer");
  assert.ok(customizerCall);
  const parsedCustomizer = JSON.parse(customizerCall.value) as {
    imageInputs?: readonly { id: string; maxFiles?: number }[];
    textInputs?: readonly { id: string; maxLength?: number }[];
  };
  assert.equal(parsedCustomizer.textInputs?.[0]?.maxLength, 40);
  assert.equal(parsedCustomizer.imageInputs?.[0]?.maxFiles, 2);
});

test("Etsy sync blocks unresolved required personalization and unverified crawl evidence before Shopify writes", () => {
  const baseEtsy = fromCustomizationNormalizerProduct({
    sourcePlatform: "etsy",
    sourceProductId: listingId,
    title: "Blocked Personalized Ornament",
    customizerAuditStatus: "error",
    variants: [{ price: 16.0, options: { Style: "Wood" } }],
  });

  assert.throws(
    () => prepareShopifySyncProduct(baseEtsy),
    /Etsy personalization has unmapped required fields/,
  );

  assert.throws(
    () =>
      prepareShopifySyncProduct({
        ...baseEtsy,
        customizerAuditStatus: "verified_static",
        syncBlockers: ["Missing verified USD sale price on variant 2"],
      }),
    /Product sync blocked: Missing verified USD sale price on variant 2/,
  );

  // Confirm Amazon product non-regression
  const amazonPrepared = prepareShopifySyncProduct(
    fromCustomizationNormalizerProduct({
      asin: "B099887766",
      parentAsin: "B099887700",
      title: "Amazon Quilt Bedding Set",
      customizerAuditStatus: "verified_static",
      variants: [{ price: 59.99, options: { Size: "Queen" } }],
    }),
  );
  assert.equal(amazonPrepared.amazonAsin, "B099887766");
  assert.equal(amazonPrepared.variants?.[0]?.sku, "AMZ-B099887766");
});
