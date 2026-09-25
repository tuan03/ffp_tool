import assert from "node:test/reporters";
import test from "node:test";
import assertStrict from "node:assert/strict";

import {
  buildProductDescriptionHtml,
  fromCustomizationNormalizerProduct,
  getShopifySyncRunner,
  replaceUrlsInObject,
  runMockShopifySync,
  runShopifySync,
  shopifySyncMockData,
  syncSingleProduct,
  type ShopifyGateway,
  type ShopifySyncProductInput,
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
    descriptionHtml: "<p>SEO description without re-escaping</p>",
    handle: "seo-handbag-c01",
    seo: { title: "SEO Handbag", description: "Personalized handbag SEO description" },
    bulletPoints: ["Feature 1"],
    media: [
      {
        url: "https://m.media-amazon.com/images/I/71xyz.jpg",
        alt: "Personalized Handbag - C01 - Image 1",
        friendlyFileName: "media-img-1.jpg",
      },
      {
        url: "https://m.media-amazon.com/images/I/video.mp4",
        kind: "VIDEO",
        alt: "Product video",
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
      source: {
        asin: "b0child001",
      },
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
  assertStrict.equal(adapted.amazonAsin, "B0CHILD001");
  assertStrict.equal(adapted.amazonParentAsin, "B0GQ33XWW7");
  assertStrict.equal(adapted.title, "Personalized Handbag - C01");
  assertStrict.equal(adapted.descriptionHtml, "<p>SEO description without re-escaping</p>");
  assertStrict.equal(adapted.handle, "seo-handbag-c01");
  assertStrict.deepEqual(adapted.seo, {
    title: "SEO Handbag",
    description: "Personalized handbag SEO description",
  });
  assertStrict.ok(adapted.tags?.includes("has-customizer"));
  assertStrict.ok(adapted.tags?.includes("asin:B0GQ33XWW7"));
  assertStrict.equal(adapted.media?.length, 1);
  assertStrict.equal(adapted.media?.[0].originalSource, "https://m.media-amazon.com/images/I/71xyz.jpg");
  assertStrict.equal(adapted.variants?.length, 1);
  assertStrict.equal(adapted.variants?.[0].price, "49.99");
  assertStrict.ok(adapted.customization?.hasCustomization);
  assertStrict.equal(adapted.customization?.assets?.length, 1);
  assertStrict.equal(adapted.customization?.assets?.[0].friendlyFileName, "base-preview.jpg");
  assertStrict.equal(adapted.vendor, "FFP Store");

  const adaptedChillgen = fromCustomizationNormalizerProduct(crawlProduct, { vendor: "CHILLGEN", productType: "Rug" });
  assertStrict.equal(adaptedChillgen.vendor, "CHILLGEN");
  assertStrict.equal(adaptedChillgen.productType, "Rug");

  const adaptedJeminise = fromCustomizationNormalizerProduct(crawlProduct, { vendor: "JEMINISE", productType: "Blanket" });
  assertStrict.equal(adaptedJeminise.vendor, "JEMINISE");
  assertStrict.equal(adaptedJeminise.productType, "Blanket");

  const adaptedWithInputParent = fromCustomizationNormalizerProduct(crawlProduct, {
    amazonParentAsin: "b0input001",
  });
  assertStrict.equal(adaptedWithInputParent.amazonParentAsin, "B0INPUT001");

  // Test Money object support as produced by amazon-crawler
  const moneyProduct = {
    ...crawlProduct,
    categories: ["Home & Kitchen", "Bedding"],
    variants: [
      {
        id: "var-money",
        price: { raw: "$59.99", amount: 59.99, currency: "USD" },
        compareAtPrice: { raw: "$79.99", amount: 79.99, currency: "USD" },
        options: { Size: "Queen" },
      },
    ],
  };
  const adaptedMoney = fromCustomizationNormalizerProduct(moneyProduct);
  assertStrict.equal(adaptedMoney.productType, "Bedding");
  assertStrict.equal(adaptedMoney.variants?.[0].price, "59.99");
  assertStrict.equal(adaptedMoney.variants?.[0].compareAtPrice, "79.99");
});

test("fromCustomizationNormalizerProduct omits variants whose Amazon selling price is missing", () => {
  const crawlProduct = {
    id: "missing-price",
    parentAsin: "B0MISSING01",
    canonicalUrl: "https://amazon.com/dp/B0MISSING01",
    title: "Missing price",
    media: [],
    variants: [
      { id: "missing", price: null, options: { Size: "Twin" } },
      { id: "priced", price: { amount: 29.95, currency: "USD" }, options: { Size: "Queen" } },
    ],
  } as unknown as CrawlProduct;

  const adapted = fromCustomizationNormalizerProduct(crawlProduct);

  assertStrict.equal(adapted.variants?.length, 1);
  assertStrict.equal(adapted.variants?.[0].price, "29.95");
  assertStrict.notEqual(adapted.variants?.[0].price, "0.00");
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

test("syncSingleProduct fails gracefully when no gateway is provided in non-dry-run mode", async () => {
  const customProd = shopifySyncMockData.products[0];
  const result = await syncSingleProduct(customProd, { dryRun: false });

  assertStrict.equal(result.success, false);
  assertStrict.ok(result.error?.includes("ShopifyGateway is required"));
});

test("syncSingleProduct records product write time when the gateway write fails", async () => {
  const gateway: ShopifyGateway = {
    async createProduct() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("OAuth endpoint unavailable");
    },
    async createVariants() {
      return { createdCount: 0 };
    },
    async uploadFile() {
      return { fileId: "unused", shopifyCdnUrl: "https://cdn.shopify.com/unused" };
    },
    async setProductMetafield() {
      return { success: true };
    },
  };

  const result = await syncSingleProduct(shopifySyncMockData.products[1], { gateway });

  assertStrict.equal(result.success, false);
  assertStrict.ok((result.timings?.productWriteMs ?? 0) >= 5);
});

test("syncSingleProduct coordinates required operations through an injected ShopifyGateway", async () => {
  const operationsCalled: string[] = [];
  const metafields = new Map<string, { type: string; value: string }>();
  let createdStatus: string | undefined;

  const fakeHiepGateway = {
    async createProduct(input: { title: string; status?: string }) {
      operationsCalled.push(`createProduct:${input.title}`);
      createdStatus = input.status;
      return { productId: "gid://shopify/Product/hiep-123", productHandle: "hiep-handle" };
    },
    async createVariants(productId: string, variants: readonly unknown[]) {
      operationsCalled.push(`createVariants:${productId}:${variants.length}`);
      return { createdCount: variants.length };
    },
    async uploadFile(input: { filename: string }) {
      operationsCalled.push(`uploadFile:${input.filename}`);
      return {
        fileId: "gid://shopify/File/hiep-f1",
        shopifyCdnUrl: `https://cdn.shopify.com/files/${input.filename}`,
      };
    },
    async setProductMetafield(input: { namespace: string; key: string; type: string; value: string }) {
      operationsCalled.push(`setMetafield:${input.namespace}.${input.key}`);
      metafields.set(`${input.namespace}.${input.key}`, {
        type: input.type,
        value: input.value,
      });
      return { success: true, metafieldId: "gid://shopify/Metafield/hiep-m1" };
    },
  };

  const customProd = shopifySyncMockData.products[0];
  const result = await syncSingleProduct(customProd, { gateway: fakeHiepGateway });

  assertStrict.equal(result.success, true);
  assertStrict.equal(result.productId, "gid://shopify/Product/hiep-123");
  assertStrict.equal(result.metafieldSet, true);
  assertStrict.equal(result.assetsUploadedCount, 2);
  assertStrict.equal(createdStatus, "ACTIVE");

  assertStrict.ok(operationsCalled.some((op) => op.startsWith("createProduct")));
  assertStrict.ok(
    operationsCalled.some((op) => op.startsWith("createVariants:gid://shopify/Product/hiep-123:2")),
  );
  assertStrict.ok(operationsCalled.some((op) => op.startsWith("uploadFile")));
  assertStrict.ok(operationsCalled.includes("setMetafield:custom.amazon_customizer"));
  assertStrict.deepEqual(metafields.get("custom.amazon_asin"), {
    type: "single_line_text_field",
    value: "B0CHILD001",
  });
  assertStrict.deepEqual(metafields.get("custom.amazon_parent_asin"), {
    type: "single_line_text_field",
    value: "B0PARENT01",
  });
  assertStrict.equal(typeof result.timings?.productWriteMs, "number");
  assertStrict.equal(typeof result.timings?.variantsMs, "number");
  assertStrict.equal(typeof result.timings?.assetUploadMs, "number");
  assertStrict.equal(typeof result.timings?.metafieldMs, "number");
  assertStrict.equal(typeof result.timings?.totalMs, "number");
});

test("syncSingleProduct rejects customized products with missing Amazon ASIN metadata before writing", async () => {
  let productWrites = 0;
  const gateway: ShopifyGateway = {
    async createProduct() {
      productWrites += 1;
      return { productId: "unused", productHandle: "unused" };
    },
    async createVariants() {
      return { createdCount: 0 };
    },
    async uploadFile() {
      return { fileId: "unused", shopifyCdnUrl: "https://cdn.shopify.com/unused" };
    },
    async setProductMetafield() {
      return { success: true };
    },
  };
  const invalidProduct: ShopifySyncProductInput = {
    ...shopifySyncMockData.products[0],
    amazonAsin: undefined,
  };

  const result = await syncSingleProduct(invalidProduct, { gateway });

  assertStrict.equal(result.success, false);
  assertStrict.equal(result.reconciliationRequired, false);
  assertStrict.match(result.error ?? "", /custom\.amazon_asin/);
  assertStrict.equal(productWrites, 0);
});

test("syncSingleProduct requires both Amazon ASIN metafields after a customized product write", async () => {
  const gateway: ShopifyGateway = {
    async createProduct() {
      throw new Error("createProduct must not run for an existing customized product");
    },
    async updateProduct(input) {
      return {
        productId: input.productId,
        productHandle: "asin-failure",
        createdVariantsCount: shopifySyncMockData.products[0].variants?.length ?? 0,
      };
    },
    async createVariants() {
      return { createdCount: 0 };
    },
    async uploadFile(input) {
      return {
        fileId: `gid://shopify/File/${input.filename}`,
        shopifyCdnUrl: `https://cdn.shopify.com/${input.filename}`,
      };
    },
    async setProductMetafield(input) {
      return { success: input.key !== "amazon_parent_asin" };
    },
  };

  const result = await syncSingleProduct(shopifySyncMockData.products[0], {
    gateway,
    existingProductId: "gid://shopify/Product/asin-failure",
  });

  assertStrict.equal(result.success, false);
  assertStrict.equal(result.reconciliationRequired, true);
  assertStrict.match(result.error ?? "", /custom\.amazon_parent_asin/);
});

test("syncSingleProduct updates the mapped Shopify product instead of creating a duplicate", async () => {
  const operationsCalled: string[] = [];
  const gateway: ShopifyGateway = {
    async createProduct() {
      throw new Error("createProduct must not run for an existing source key");
    },
    async updateProduct(input) {
      operationsCalled.push(`update:${input.productId}`);
      assertStrict.equal(input.status, undefined);
      return {
        productId: input.productId,
        productHandle: "existing-product",
        createdVariantsCount: input.variants?.length ?? 0,
      };
    },
    async createVariants() {
      throw new Error("createVariants must not run after an exact update");
    },
    async uploadFile(input) {
      return {
        fileId: `gid://shopify/File/${input.filename}`,
        shopifyCdnUrl: `https://cdn.shopify.com/${input.filename}`,
      };
    },
    async setProductMetafield(input) {
      operationsCalled.push(`metafield:${input.key}`);
      return { success: true };
    },
  };

  const result = await syncSingleProduct(shopifySyncMockData.products[1], {
    gateway,
    existingProductId: "gid://shopify/Product/123",
  });

  assertStrict.equal(result.success, true);
  assertStrict.deepEqual(operationsCalled, ["update:gid://shopify/Product/123"]);
});

test("syncSingleProduct fails when Shopify does not persist every requested variant", async () => {
  const gateway: ShopifyGateway = {
    async createProduct() {
      return {
        productId: "gid://shopify/Product/partial",
        productHandle: "partial",
        createdVariantsCount: 1,
      };
    },
    async createVariants() {
      return { createdCount: 0 };
    },
    async uploadFile() {
      return { fileId: "unused", shopifyCdnUrl: "https://cdn.shopify.com/unused" };
    },
    async setProductMetafield() {
      return { success: true };
    },
  };

  const result = await syncSingleProduct(shopifySyncMockData.products[0], { gateway });

  assertStrict.equal(result.success, false);
  assertStrict.equal(result.reconciliationRequired, true);
  assertStrict.match(result.error ?? "", /variants incomplete/i);
  assertStrict.equal(typeof result.timings?.productWriteMs, "number");
  assertStrict.equal(typeof result.timings?.totalMs, "number");
});

test("syncSingleProduct leverages uploadFilesBatch and deduplicates asset URLs", async () => {
  const operationsCalled: string[] = [];
  let batchInputsCount = 0;

  const batchGateway = {
    async createProduct(input: { title: string }) {
      operationsCalled.push(`createProduct:${input.title}`);
      return { productId: "gid://shopify/Product/batch-123", productHandle: "batch-handle" };
    },
    async createVariants(productId: string, variants: readonly unknown[]) {
      operationsCalled.push(`createVariants:${productId}:${variants.length}`);
      return { createdCount: variants.length };
    },
    async uploadFile(_input: { filename: string }) {
      throw new Error("uploadFile should not be called when uploadFilesBatch is provided");
    },
    async uploadFilesBatch(inputs: readonly { originalSource: string; filename: string }[]) {
      operationsCalled.push(`uploadFilesBatch:${inputs.length}`);
      batchInputsCount = inputs.length;
      return inputs.map((item, idx) => ({
        fileId: `gid://shopify/MediaImage/batch-${idx + 1}`,
        shopifyCdnUrl: `https://cdn.shopify.com/files/${item.filename}`,
        originalSource: item.originalSource,
      }));
    },
    async setProductMetafield(input: { namespace: string; key: string }) {
      operationsCalled.push(`setMetafield:${input.namespace}.${input.key}`);
      return { success: true, metafieldId: "gid://shopify/Metafield/batch-m1" };
    },
  };

  const customProd: ShopifySyncProductInput = {
    ...shopifySyncMockData.products[0],
    customization: {
      ...shopifySyncMockData.products[0].customization,
      hasCustomization: true,
      assets: [
        { url: "https://example.com/asset-1.png", friendlyFileName: "asset-1.png", alt: "A1" },
        { url: "https://example.com/asset-1.png", friendlyFileName: "asset-1-dup.png", alt: "A1-dup" },
        { url: "https://example.com/asset-2.png", friendlyFileName: "asset-2.png", alt: "A2" },
      ],
    },
  };

  const result = await syncSingleProduct(customProd, {
    gateway: batchGateway as unknown as ShopifyGateway,
  });

  assertStrict.equal(result.success, true);
  assertStrict.equal(result.productId, "gid://shopify/Product/batch-123");
  assertStrict.equal(batchInputsCount, 2);
  assertStrict.equal(result.assetsUploadedCount, 2);
  assertStrict.ok(operationsCalled.some((op) => op.startsWith("uploadFilesBatch:2")));
  assertStrict.ok(!operationsCalled.some((op) => op.startsWith("uploadFile:")));
});

test("syncSingleProduct does not start a Shopify mutation after cancellation", async () => {
  const controller = new AbortController();
  let mutationCalls = 0;
  const gateway: ShopifyGateway = {
    createProduct: async () => {
      mutationCalls += 1;
      return { productId: "product-1", productHandle: "product-1" };
    },
    createVariants: async () => ({ createdCount: 0 }),
    uploadFile: async () => ({
      fileId: "gid://shopify/MediaImage/cancelled-test",
      shopifyCdnUrl: "https://example.test/file.jpg",
    }),
    setProductMetafield: async () => ({ success: true }),
  };
  controller.abort();

  const result = await syncSingleProduct(shopifySyncMockData.products[0], {
    gateway,
    signal: controller.signal,
  });

  assertStrict.equal(result.success, false);
  assertStrict.equal(mutationCalls, 0);
  assertStrict.match(result.error ?? "", /cancelled/i);
});

test("syncSingleProduct retries assets omitted from a partial batch response", async () => {
  const individuallyUploaded: string[] = [];
  const gateway = {
    async createProduct() {
      return { productId: "gid://shopify/Product/partial-assets", productHandle: "partial-assets" };
    },
    async createVariants(_productId: string, variants: readonly unknown[]) {
      return { createdCount: variants.length };
    },
    async uploadFilesBatch(inputs: readonly { originalSource: string; filename: string }[]) {
      const first = inputs[0];
      return first
        ? [{
            fileId: "gid://shopify/MediaImage/batch-first",
            shopifyCdnUrl: `https://cdn.shopify.com/files/${first.filename}`,
            originalSource: first.originalSource,
          }]
        : [];
    },
    async uploadFile(input: { originalSource: string; filename: string }) {
      individuallyUploaded.push(input.originalSource);
      return {
        fileId: "gid://shopify/MediaImage/retried",
        shopifyCdnUrl: `https://cdn.shopify.com/files/${input.filename}`,
      };
    },
    async setProductMetafield() {
      return { success: true, metafieldId: "gid://shopify/Metafield/partial-assets" };
    },
  };
  const product: ShopifySyncProductInput = {
    ...shopifySyncMockData.products[0],
    customization: {
      ...shopifySyncMockData.products[0].customization,
      hasCustomization: true,
      assets: [
        { url: "https://example.com/asset-1.png", friendlyFileName: "asset-1.png" },
        { url: "https://example.com/asset-2.png", friendlyFileName: "asset-2.png" },
      ],
    },
  };

  const result = await syncSingleProduct(product, {
    gateway: gateway as unknown as ShopifyGateway,
  });

  assertStrict.equal(result.success, true);
  assertStrict.equal(result.assetsUploadedCount, 2);
  assertStrict.deepEqual(individuallyUploaded, ["https://example.com/asset-2.png"]);
});


