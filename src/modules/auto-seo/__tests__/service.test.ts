import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors/app-error";
import { MockAutoSeoClient } from "../mocks/runner";
import { getAutoSeoClient } from "../runtime";
import { RealAutoSeoClient, runAutoSeo } from "../service";
import { mapShopifyProductToAutoSeoCandidate } from "../shopify-adapter";
import type { AutoSeoProductCandidate, ShopifyProductForAutoSeoUi } from "../types";

test("mapShopifyProductToAutoSeoCandidate maps fields and sets 1-based image position", () => {
  const shopifyProduct: ShopifyProductForAutoSeoUi = {
    id: "gid://shopify/Product/12345",
    handle: "test-rug",
    title: "Test Rug Title",
    descriptionHtml: "<p>Hello world</p>",
    status: "ACTIVE",
    images: [
      { url: "https://example.com/img1.jpg", altText: "First Image" },
      { url: "https://example.com/img2.jpg", altText: "Second Image" },
    ],
  };

  const candidate = mapShopifyProductToAutoSeoCandidate(shopifyProduct);

  assert.equal(candidate.productId, "gid://shopify/Product/12345");
  assert.equal(candidate.handle, "test-rug");
  assert.equal(candidate.title, "Test Rug Title");
  assert.equal(candidate.descriptionHtml, "<p>Hello world</p>");
  assert.equal(candidate.images.length, 2);
  assert.equal(candidate.images[0]?.url, "https://example.com/img1.jpg");
  assert.equal(candidate.images[0]?.altText, "First Image");
  assert.equal(candidate.images[0]?.position, 1);
  assert.equal(candidate.images[1]?.url, "https://example.com/img2.jpg");
  assert.equal(candidate.images[1]?.position, 2);
});

test("mapShopifyProductToAutoSeoCandidate handles missing description and empty images gracefully", () => {
  const shopifyProduct = {
    id: "gid://shopify/Product/999",
    handle: "blank-sample",
    title: "Blank Sample",
  };

  const candidate = mapShopifyProductToAutoSeoCandidate(shopifyProduct);

  assert.equal(candidate.descriptionHtml, "");
  assert.deepEqual(candidate.images, []);
});

test("runAutoSeo rejects empty niche with AppError", async () => {
  const candidate: AutoSeoProductCandidate = {
    productId: "gid://shopify/Product/1",
    handle: "rug-1",
    title: "Rug 1",
    descriptionHtml: "<p>Desc</p>",
    images: [{ url: "https://example.com/1.jpg", position: 1 }],
  };

  await assert.rejects(
    async () => {
      await runAutoSeo({
        workflowId: "wf_test_1",
        niche: "   ",
        products: [candidate],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_INVALID_INPUT");
      return true;
    },
  );
});

test("runAutoSeo rejects empty products list with AppError", async () => {
  await assert.rejects(
    async () => {
      await runAutoSeo({
        workflowId: "wf_test_2",
        niche: "custom rug",
        products: [],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_INVALID_INPUT");
      return true;
    },
  );
});

test("runAutoSeo filters by selectedProductIds and generates warnings", async () => {
  const candidate1: AutoSeoProductCandidate = {
    productId: "gid://shopify/Product/101",
    handle: "good-rug",
    title: "Good Rug",
    descriptionHtml: "<p>Great rug</p>",
    images: [{ url: "https://example.com/rug.jpg", position: 1 }],
  };

  const candidate2: AutoSeoProductCandidate = {
    productId: "gid://shopify/Product/102",
    handle: "",
    title: "No Image Rug",
    descriptionHtml: "",
    images: [],
  };

  const output = await runAutoSeo({
    workflowId: "wf_test_3",
    niche: "custom rug",
    products: [candidate1, candidate2],
    selectedProductIds: ["gid://shopify/Product/102"],
  });

  assert.equal(output.workflowId, "wf_test_3");
  assert.equal(output.selectedCount, 1);
  assert.equal(output.seoContentInputs.length, 1);
  assert.equal(output.seoContentInputs[0]?.productId, "gid://shopify/Product/102");
  assert.equal(output.seoContentInputs[0]?.niche, "custom rug");

  // Warnings check for candidate2
  assert.ok(output.warnings.some((w) => w.includes("has no images")));
  assert.ok(output.warnings.some((w) => w.includes("has empty handle")));
  assert.ok(output.warnings.some((w) => w.includes("has empty descriptionHtml")));
});

test("MockAutoSeoClient returns deep copies and runs workflow properly", async () => {
  const client = new MockAutoSeoClient();
  const products1 = await client.loadProducts();
  assert.ok(products1.length >= 4);

  const originalTitle = products1[0]?.title;
  // Mutate product object
  (products1 as unknown as Record<string, unknown>[])[0]!.title = "Mutated Title";

  const products2 = await client.loadProducts();
  assert.equal(products2[0]?.title, originalTitle);

  const candidates = products2.map(mapShopifyProductToAutoSeoCandidate);
  const result = await client.runAutoSeo({
    workflowId: "wf_mock_test",
    niche: "personalized blankets",
    products: candidates,
    selectedProductIds: [products2[0]!.id],
  });

  assert.equal(result.selectedCount, 1);
  assert.equal(result.seoContentInputs[0]?.niche, "personalized blankets");
});

test("RealAutoSeoClient handles network failure with AppError", async () => {
  const realClient = new RealAutoSeoClient("http://invalid-test-domain-12345.xyz");

  await assert.rejects(
    async () => {
      await realClient.loadProducts();
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      return true;
    },
  );
});

test("getAutoSeoClient selects correct client instance based on environment", () => {
  const mockClient = getAutoSeoClient("mock");
  assert.ok(mockClient instanceof MockAutoSeoClient);

  const devClient = getAutoSeoClient("development");
  assert.ok(devClient instanceof RealAutoSeoClient);

  const prodClient = getAutoSeoClient("production");
  assert.ok(prodClient instanceof RealAutoSeoClient);
});
