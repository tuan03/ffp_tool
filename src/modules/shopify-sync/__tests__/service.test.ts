import assert from "node:test/reporters";
import test from "node:test";
import assertStrict from "node:assert/strict";

import {
  buildProductDescriptionHtml,
  createShopifyClient,
  fromCustomizationNormalizerProduct,
  getShopifySyncRunner,
  replaceUrlsInObject,
  runMockShopifySync,
  runShopifySync,
  shopifySyncMockData,
  syncSingleProduct,
} from "../index";
import type { CrawlProduct } from "../../customization-normalizer";

test("buildProductDescriptionHtml formats description, bullet points and specs table", () => {
  const sampleProduct: Partial<CrawlProduct> = {
    description: "Handcrafted leather handbag",
    bulletPoints: ["Durable leather", "Personalized tag"],
    productDetails: {
      Dimensions: "10x8x4 inches",
      Material: "PU Leather",
    },
  };

  const html = buildProductDescriptionHtml(sampleProduct);
  assertStrict.ok(html.includes("Handcrafted leather handbag"));
  assertStrict.ok(html.includes("<li>Durable leather</li>"));
  assertStrict.ok(html.includes("<h3>Specifications</h3>"));
  assertStrict.ok(html.includes("Dimensions"));
});

test("fromCustomizationNormalizerProduct adapts normalized crawl product into ShopifySyncProductInput", () => {
  const crawlProduct: CrawlProduct = {
    id: "prod-100",
    parentAsin: "B0GQ33XWW7",
    canonicalUrl: "https://amazon.com/dp/B0GQ33XWW7",
    title: "Personalized Handbag - C01",
    description: "A great bag",
    bulletPoints: ["Feature 1"],
    media: [
      {
        url: "https://m.media-amazon.com/images/I/71xyz.jpg",
        alt: "Personalized Handbag - C01 - Image 1",
        friendlyFileName: "media-img-1.jpg",
      },
    ],
    variants: [
      {
        id: "var-1",
        title: "Medium",
        price: 49.99,
        options: { Size: "Medium" },
      },
    ],
    customization: {
      hasCustomization: true,
      assets: [
        {
          url: "https://m.media-amazon.com/images/I/61base.jpg",
          alt: "Personalized Handbag - C01 - Base Preview",
          friendlyFileName: "base-preview.jpg",
          roles: ["base"],
        },
      ],
    },
  };

  const adapted = fromCustomizationNormalizerProduct(crawlProduct);

  assertStrict.equal(adapted.id, "prod-100");
  assertStrict.equal(adapted.title, "Personalized Handbag - C01");
  assertStrict.ok(adapted.tags?.includes("has-customizer"));
  assertStrict.ok(adapted.tags?.includes("asin:B0GQ33XWW7"));
  assertStrict.equal(adapted.media?.length, 1);
  assertStrict.equal(adapted.media?.[0].originalSource, "https://m.media-amazon.com/images/I/71xyz.jpg");
  assertStrict.equal(adapted.variants?.length, 1);
  assertStrict.equal(adapted.variants?.[0].price, "49.99");
  assertStrict.ok(adapted.customization?.hasCustomization);
  assertStrict.equal(adapted.customization?.assets?.length, 1);
  assertStrict.equal(adapted.customization?.assets?.[0].friendlyFileName, "base-preview.jpg");
});

test("replaceUrlsInObject replaces all matched URLs recursively", () => {
  const replacements = new Map<string, string>([
    ["https://amazon.com/old-base.jpg", "https://cdn.shopify.com/s/files/new-base.jpg"],
    ["https://amazon.com/old-thumb.jpg", "https://cdn.shopify.com/s/files/new-thumb.jpg"],
  ]);

  const target = {
    preview: "https://amazon.com/old-base.jpg",
    nested: {
      images: [
        "https://amazon.com/old-thumb.jpg",
        "https://amazon.com/untouched.jpg",
      ],
    },
    count: 10,
  };

  const result = replaceUrlsInObject(target, replacements) as typeof target;

  assertStrict.equal(result.preview, "https://cdn.shopify.com/s/files/new-base.jpg");
  assertStrict.equal(result.nested.images[0], "https://cdn.shopify.com/s/files/new-thumb.jpg");
  assertStrict.equal(result.nested.images[1], "https://amazon.com/untouched.jpg");
  assertStrict.equal(result.count, 10);
});

test("syncSingleProduct runs in dry-run mode for both customized and non-customized products", async () => {
  const customProd = shopifySyncMockData.products[0];
  const standardProd = shopifySyncMockData.products[1];

  const customResult = await syncSingleProduct(customProd, { dryRun: true });
  assertStrict.equal(customResult.success, true);
  assertStrict.equal(customResult.dryRun, true);
  assertStrict.equal(customResult.metafieldSet, true);
  assertStrict.equal(customResult.assetsUploadedCount, 2);
  assertStrict.equal(customResult.variantsCount, 2);

  const standardResult = await syncSingleProduct(standardProd, { dryRun: true });
  assertStrict.equal(standardResult.success, true);
  assertStrict.equal(standardResult.dryRun, true);
  assertStrict.equal(standardResult.metafieldSet, false);
  assertStrict.equal(standardResult.assetsUploadedCount, 0);
  assertStrict.equal(standardResult.variantsCount, 1);
});

test("runShopifySync batch handles multiple products in dry-run mode", async () => {
  const batchResult = await runShopifySync(shopifySyncMockData, { dryRun: true });

  assertStrict.equal(batchResult.jobId, "mock-shopify-sync-job-1");
  assertStrict.equal(batchResult.totalProducts, 2);
  assertStrict.equal(batchResult.successfulProducts, 2);
  assertStrict.equal(batchResult.failedProducts, 0);
  assertStrict.equal(batchResult.totalAssetsUploaded, 2);
  assertStrict.equal(batchResult.results.length, 2);
});

test("runMockShopifySync produces independent mock result matching contract", async () => {
  const result = await runMockShopifySync(shopifySyncMockData);

  assertStrict.equal(result.totalProducts, 2);
  assertStrict.equal(result.successfulProducts, 2);
  assertStrict.equal(result.totalAssetsUploaded, 2);
  assertStrict.ok(result.results[0].productId?.startsWith("gid://shopify/Product/"));
  assertStrict.equal(result.results[0].metafieldSet, true);
  assertStrict.equal(result.results[1].metafieldSet, false);
});

test("getShopifySyncRunner selects mock runner in mock environment and real runner otherwise", () => {
  const mockRunner = getShopifySyncRunner("mock");
  const prodRunner = getShopifySyncRunner("production");
  const devRunner = getShopifySyncRunner("development");

  assertStrict.equal(mockRunner, runMockShopifySync);
  assertStrict.equal(prodRunner, runShopifySync);
  assertStrict.equal(devRunner, runShopifySync);
});

test("createShopifyClient validates credentials and normalizes store domain", () => {
  assertStrict.throws(
    () => createShopifyClient({ shop: "", accessToken: "" }),
    /shop domain is required|accessToken is required/,
  );

  const client = createShopifyClient({
    shop: "my-test-store",
    accessToken: "shpat_mock_token_123",
  });

  assertStrict.equal(client.shop, "my-test-store.myshopify.com");
  assertStrict.equal(client.apiVersion, "2026-04");
});
