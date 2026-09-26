import assert from "node:assert/strict";
import test from "node:test";

import {
  customizationNormalizerMockData,
  generateFriendlyFileName,
  getCustomizationNormalizerRunner,
  hasCustomization,
  runCustomizationNormalizer,
  runMockCustomizationNormalizer,
  slugify,
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
