import assert from "node:assert/strict";
import test from "node:test";

import {
  computeNormalizedProductChecksum,
  customizationNormalizerMockData,
  fromPinterestPodItem,
  fromShopifyProduct,
  generateFriendlyFileName,
  getCustomizationNormalizerRunner,
  hasCustomization,
  isSafeHttpUrl,
  runCustomizationNormalizer,
  runMockCustomizationNormalizer,
  slugify,
  validateProductPayload,
} from "..";
import type { CrawlProduct, CustomizationNormalizerInput } from "..";

test("slugify converts group and option labels to clean kebab-case", () => {
  assert.equal(slugify("Choose Leather Bag Size"), "choose-leather-bag-size");
  assert.equal(slugify("Yes, Confirm!"), "yes-confirm");
  assert.equal(slugify("Màu sắc da Đen"), "mau-sac-da-den");
});

test("generateFriendlyFileName creates deterministic SEO-friendly filenames", () => {
  const url = "https://m.media-amazon.com/images/S/test-image.jpg";
  const name1 = generateFriendlyFileName(url, "Leather Bag Size Medium", "thumbnail");
  const name2 = generateFriendlyFileName(url, "Leather Bag Size Medium", "thumbnail");

  assert.equal(name1, name2);
  assert.match(name1, /^thumbnail-leather-bag-size-medium-[a-f0-9]{6}\.jpg$/);
});

test("hasCustomization correctly detects presence of customization", () => {
  const withCustom: CrawlProduct = {
    title: "Customized Mug",
    customization: {
      hasCustomization: true,
      optionGroups: [{ id: "opt-1", label: "Color", options: [] }],
    },
  };

  const withoutCustom: CrawlProduct = {
    title: "Normal Mug",
    customization: null,
  };

  const emptyCustom: CrawlProduct = {
    title: "Empty Mug",
    customization: {
      hasCustomization: false,
    },
  };

  assert.equal(hasCustomization(withCustom), true);
  assert.equal(hasCustomization(withoutCustom), false);
  assert.equal(hasCustomization(emptyCustom), false);
});

test("runCustomizationNormalizer keeps products without customization completely untouched", async () => {
  const untouchedProduct: CrawlProduct = {
    id: "sang-prod-1",
    title: "Sang's Regular Handbag",
    media: [
      {
        url: "https://m.media-amazon.com/images/I/raw-product.jpg",
        kind: "image",
      },
    ],
    customization: null,
  };

  const input: CustomizationNormalizerInput = {
    jobId: "job-sang-001",
    status: "completed",
    products: [untouchedProduct],
  };

  const output = await runCustomizationNormalizer(input);

  assert.equal(output.products.length, 1);
  assert.deepEqual(output.products[0], untouchedProduct);
  assert.equal(output.normalizationSummary.customizedProducts, 0);
  assert.equal(output.normalizationSummary.untouchedProducts, 1);
});

test("runCustomizationNormalizer normalizes alt text and friendly file names for customized products", async () => {
  const customizedProduct: CrawlProduct = {
    id: "sang-prod-2",
    title: "Custom Christian Leather Handbag - C01",
    media: [
      {
        url: "https://m.media-amazon.com/images/I/514mV7TwmHL._AC_US40_.jpg",
        kind: "image",
      },
    ],
    customization: {
      hasCustomization: true,
      pricing: {
        paidOptionGroups: [
          {
            id: "size-group",
            label: "Choose Leather Bag Size",
            options: [
              {
                id: "size-medium",
                label: "Medium",
                thumbnailImage: {
                  url: "https://m.media-amazon.com/images/S/thumb-medium.png",
                },
              },
            ],
          },
        ],
      },
      assets: [
        {
          url: "https://m.media-amazon.com/images/S/base-preview.png",
          roles: ["base"],
        },
      ],
    },
  };

  const input: CustomizationNormalizerInput = {
    jobId: "job-sang-002",
    status: "completed",
    products: [customizedProduct],
  };

  const output = await runCustomizationNormalizer(input);

  assert.equal(output.normalizationSummary.customizedProducts, 1);
  assert.equal(output.normalizationSummary.untouchedProducts, 0);

  const normalized = output.products[0];
  assert.notEqual(normalized, customizedProduct); // Immutability test

  // Verify option thumbnail alt and friendly filename
  const optionThumb = normalized.customization?.pricing?.paidOptionGroups?.[0]?.options?.[0]?.thumbnailImage;
  assert.equal(optionThumb?.alt, "Choose Leather Bag Size - Medium (Thumbnail)");
  assert.match(String(optionThumb?.friendlyFileName), /^thumbnail-choose-leather-bag-size-medium-[a-f0-9]{6}\.png$/);

  // Verify customization asset alt and friendly filename
  const baseAsset = normalized.customization?.assets?.[0];
  assert.equal(baseAsset?.alt, "Custom Christian Leather Handbag - C01 - Base Preview");
  assert.match(String(baseAsset?.friendlyFileName), /^base-custom-christian-leather-handbag-c01-.*-[a-f0-9]{6}\.png$/);

  // Verify product media alt and cleaned URL
  const mediaItem = normalized.media?.[0];
  assert.equal(mediaItem?.alt, "Custom Christian Leather Handbag - C01 - Image 1");
  assert.equal(mediaItem?.url, "https://m.media-amazon.com/images/I/514mV7TwmHL.jpg"); // cleanImageUrl stripped ._AC_US40_
});

test("runMockCustomizationNormalizer returns mock data with matching jobId", async () => {
  const result = await runMockCustomizationNormalizer({
    jobId: "custom-job-999",
    status: "mock",
    products: [],
  });

  assert.equal(result.jobId, "custom-job-999");
  assert.equal(result.normalizationSummary.totalProducts, 2);
  assert.notEqual(result.products, customizationNormalizerMockData.products);
});

test("runs successfully on real crawl fixture if available", async () => {
  const fs = await import("node:fs");
  const samplePath = "D:/all_about_shopify/tools/amazon-crawl-20260921-204713-bd817fbad4394851.json";

  if (!fs.existsSync(samplePath)) {
    return;
  }

  const raw = JSON.parse(fs.readFileSync(samplePath, "utf8")) as CustomizationNormalizerInput;
  const result = await runCustomizationNormalizer(raw);

  assert.equal(result.normalizationSummary.totalProducts, 10);
  assert.equal(result.normalizationSummary.customizedProducts, 9);
  assert.equal(result.normalizationSummary.untouchedProducts, 1);
  assert.ok(result.normalizationSummary.normalizedAssetsCount > 0);

  // Product 7 (C06) had null customization in crawl file, so it was kept untouched
  assert.equal(result.products[7].customization, null);
  assert.deepEqual(result.products[7], raw.products[7]);

  // Check product 0 normalized values
  const product0 = result.products[0];
  assert.ok(product0.customization?.pricing?.paidOptionGroups);
  const opt0 = product0.customization.pricing.paidOptionGroups[0].options[0];
  assert.ok(opt0.thumbnailImage?.alt?.includes("Would you like to purchase a matching Leather Long Wallet? - No"));
  assert.ok(opt0.thumbnailImage?.friendlyFileName?.startsWith("thumbnail-would-you-like-to-purchase-a-matching-le"));
});

test("getCustomizationNormalizerRunner returns mock runner in mock environment and real runner otherwise", async () => {
  const mockRunner = getCustomizationNormalizerRunner("mock");
  assert.equal(mockRunner, runMockCustomizationNormalizer);

  const devRunner = getCustomizationNormalizerRunner("development");
  assert.equal(devRunner, runCustomizationNormalizer);

  const prodRunner = getCustomizationNormalizerRunner("production");
  assert.equal(prodRunner, runCustomizationNormalizer);
});

test("isSafeHttpUrl allows standard HTTPS URLs and blocks dangerous schemes or internal hosts", () => {
  assert.equal(isSafeHttpUrl("https://m.media-amazon.com/images/I/valid.jpg"), true);
  assert.equal(isSafeHttpUrl("http://cdn.shopify.com/s/files/img.png"), true);

  // Dangerous protocols
  assert.equal(isSafeHttpUrl("file:///etc/passwd"), false);
  assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHttpUrl("data:image/png;base64,iVBORw0KGgoAAAANS"), false);

  // SSRF internal hosts
  assert.equal(isSafeHttpUrl("http://localhost:3001/api/secret"), false);
  assert.equal(isSafeHttpUrl("http://127.0.0.1:3001/api"), false);
  assert.equal(isSafeHttpUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(isSafeHttpUrl("http://internal.service.local/data"), false);
});

test("validateProductPayload detects missing required fields and dangerous payload items", () => {
  // Valid product
  const validProduct = {
    title: "Personalized Ceramic Mug",
    asin: "B0GQ33XWW7",
    media: [{ url: "https://example.com/mug.jpg" }],
  };
  const validRes = validateProductPayload(validProduct);
  assert.equal(validRes.isValid, true);
  assert.equal(validRes.errors.length, 0);

  // Invalid payload: non-object
  assert.equal(validateProductPayload(null).isValid, false);
  assert.equal(validateProductPayload("string").isValid, false);

  // Missing title
  const missingTitle = { asin: "B0GQ33XWW7" };
  const resMissing = validateProductPayload(missingTitle);
  assert.equal(resMissing.isValid, false);
  assert.ok(resMissing.errors.some((e) => e.includes("title")));

  // Invalid ASIN format
  const badAsin = { title: "Item", asin: "INVALID_ASIN_TOO_LONG" };
  const resBadAsin = validateProductPayload(badAsin);
  assert.equal(resBadAsin.isValid, false);
  assert.ok(resBadAsin.errors.some((e) => e.includes("Invalid ASIN format")));

  // Unsafe SSRF URL in media
  const ssrfProduct = {
    title: "Exploit Test",
    media: [{ url: "http://169.254.169.254/secret" }],
  };
  const resSsrf = validateProductPayload(ssrfProduct);
  assert.equal(resSsrf.isValid, false);
  assert.ok(resSsrf.errors.some((e) => e.includes("unsafe or invalid URL")));
});

test("fromPinterestPodItem adapts Pinterest POD deliverable into unified CrawlProduct", () => {
  const deliverable = {
    designId: "pin_design_888",
    originalPinTitle: "Minimalist Botanical Wall Rug",
    productType: "rug",
    trendKeywords: ["botanical", "minimalist", "nordic rug"],
    vendor: "Jeminise",
    cutoutProduct: {
      transparentUrl: "https://cdn.pod.example.com/cutout-transparent.png",
      whiteBgUrl: "https://cdn.pod.example.com/cutout-white.png",
    },
    composedMockups: [
      {
        mockupUrl: "https://cdn.pod.example.com/mockup-living-room.jpg",
        detectedSceneType: "Living Room",
      },
    ],
    variants: [
      {
        title: "Large (4x6 ft)",
        price: "89.99",
        sku: "RUG-BOT-LG",
      },
    ],
  };

  const adapted = fromPinterestPodItem(deliverable);

  assert.equal(adapted.sourcePlatform, "pinterest");
  assert.equal(adapted.sourceProductId, "pin_design_888");
  assert.equal(adapted.title, "Minimalist Botanical Wall Rug");
  assert.equal(adapted.handle, "minimalist-botanical-wall-rug");
  assert.equal(adapted.media?.length, 3);
  assert.equal(adapted.media?.[0]?.url, "https://cdn.pod.example.com/cutout-transparent.png");
  assert.equal(adapted.media?.[2]?.alt, "Minimalist Botanical Wall Rug - Living Room");
  assert.ok(adapted.tags?.includes("source:pinterest-pod"));
  assert.ok(adapted.tags?.includes("botanical"));
});

test("fromShopifyProduct adapts Shopify Product input into unified CrawlProduct", () => {
  const shopifyProd = {
    id: "gid://shopify/Product/9999",
    title: "Embroidered Denim Jacket",
    handle: "embroidered-denim-jacket",
    vendor: "Capozen",
    tags: ["denim", "custom"],
    images: [
      { id: "img-1", url: "https://cdn.shopify.com/s/files/jacket.jpg", altText: "Jacket" },
    ],
    metafields: [
      {
        namespace: "custom",
        key: "amazon_customizer",
        value: JSON.stringify({
          hasCustomization: true,
          surfaces: [{ name: "Back", surfaceId: "surf_back" }],
        }),
      },
    ],
  };

  const adapted = fromShopifyProduct(shopifyProd);

  assert.equal(adapted.sourcePlatform, "shopify");
  assert.equal(adapted.sourceProductId, "gid://shopify/Product/9999");
  assert.equal(adapted.title, "Embroidered Denim Jacket");
  assert.equal(adapted.media?.length, 1);
  assert.equal(adapted.customization?.hasCustomization, true);
});

test("computeNormalizedProductChecksum produces deterministic hash regardless of object key order", () => {
  const prod1: CrawlProduct = {
    title: "Custom Mug",
    handle: "custom-mug",
    asin: "B0GQ33XWW7",
    description: "Ceramic",
    media: [{ url: "https://example.com/img1.jpg" }],
  };

  // Same content, different key order
  const prod2: CrawlProduct = {
    description: "Ceramic",
    asin: "B0GQ33XWW7",
    media: [{ url: "https://example.com/img1.jpg" }],
    handle: "custom-mug",
    title: "Custom Mug",
  };

  const hash1 = computeNormalizedProductChecksum(prod1);
  const hash2 = computeNormalizedProductChecksum(prod2);

  assert.equal(hash1, hash2);
  assert.match(hash1, /^[a-f0-9]{16}$/);

  // Different product yields different checksum
  const prodDiff: CrawlProduct = {
    ...prod1,
    title: "Custom Mug Modified",
  };
  assert.notEqual(computeNormalizedProductChecksum(prodDiff), hash1);
});
