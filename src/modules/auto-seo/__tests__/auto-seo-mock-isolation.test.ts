import assert from "node:assert/strict";
import test from "node:test";

import { handoverAutoSeoToSeo } from "../../orchestrator";
import { createAutoSeoModuleApiClient } from "../../orchestrator/auto-seo-module-api-client";
import { getSeoContentRunner } from "../../seo-content";
import { MockAutoSeoClient } from "../mocks/runner";
import { getAutoSeoClient } from "../runtime";
import { mapShopifyProductToAutoSeoCandidate } from "../shopify-adapter";
import type { AutoSeoSourceProduct } from "../../orchestrator";
import type { ModuleApiRunner } from "../../module-api";

test("mock-isolation: getAutoSeoClient('mock') returns MockAutoSeoClient instance", () => {
  const client = getAutoSeoClient("mock");
  assert.ok(client instanceof MockAutoSeoClient);
});

test("mock-isolation: MockAutoSeoClient loads mock products without network calls", async () => {
  const client = getAutoSeoClient("mock");
  const products = await client.loadProducts();
  assert.ok(products.length > 0, "Mock mode must load mock products");
  assert.ok(products.every((p) => typeof p.id === "string" && p.title));
});

test("mock-isolation: MockAutoSeoClient.runAutoSeoBackup never calls fetch or /api/auto-seo/run", async () => {
  const client = getAutoSeoClient("mock");

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  let fetchUrl = "";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalled = true;
    fetchUrl = typeof input === "string" ? input : input.toString();
    throw new Error(`Unexpected fetch call to: ${fetchUrl}`);
  }) as typeof fetch;

  try {
    const products = await client.loadProducts();
    const result = await client.runAutoSeoBackup({
      workflowId: "test-mock-wf-1",
      storeId: "store-chillgen-mock",
      shopDomain: "chillgen-mock.myshopify.com",
      products,
    });

    assert.equal(fetchCalled, false, "fetch must NOT be called in mock runAutoSeoBackup");
    assert.equal(result.downstreamStatus, "SENT");
    assert.equal(result.backedUpCount, products.length);
    assert.equal(result.backupIds.length, products.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mock-isolation: full mock flow (load -> run -> handover) completes in-memory without external calls", async () => {
  const client = getAutoSeoClient("mock");
  const seoRunner = getSeoContentRunner("mock");

  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCallCount++;
    throw new Error(`Unexpected network fetch: ${input.toString()}`);
  }) as typeof fetch;

  try {
    // 1. Load mock products
    const products = await client.loadProducts();
    assert.ok(products.length > 0);

    // 2. Select product
    const selectedProduct = products[0]!;
    const storeInfo = await client.getStoreInfo();

    // 3. Run backup in mock mode
    const backupResult = await client.runAutoSeoBackup({
      workflowId: "wf-mock-e2e",
      storeId: storeInfo.storeId,
      shopDomain: storeInfo.shopDomain,
      products: [selectedProduct],
    });
    assert.equal(backupResult.downstreamStatus, "SENT");

    // 4. Run mock auto seo
    const seoResult = await client.runAutoSeo({
      workflowId: "wf-mock-e2e",
      products: [mapShopifyProductToAutoSeoCandidate(selectedProduct)],
      selectedProductIds: [selectedProduct.id],
    });
    assert.equal(seoResult.selectedCount, 1);

    // 5. Handover to SEO runner (mock runner)
    const handoverResult = await handoverAutoSeoToSeo(
      {
        products: [selectedProduct] as unknown as AutoSeoSourceProduct[],
        storeId: storeInfo.storeId,
      },
      { seoRunner },
    );
    assert.equal(handoverResult.successful, 1);
    assert.equal(handoverResult.items.length, 1);
    assert.equal(fetchCallCount, 0, "No network calls throughout entire mock flow");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mock-isolation: AutoSeoModuleApiClient would have invoked /api/auto-seo/run", async () => {
  const dummyRunner = (async () => ({})) as unknown as ModuleApiRunner;
  const apiClient = createAutoSeoModuleApiClient(dummyRunner);

  const originalFetch = globalThis.fetch;
  let interceptedUrl = "";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    interceptedUrl = typeof input === "string" ? input : input.toString();
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          workflowId: "test-wf",
          backedUpCount: 1,
          backupIds: ["b-1"],
          downstreamStatus: "SENT",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await apiClient.runAutoSeoBackup({
      workflowId: "test-wf",
      storeId: "store-1",
      shopDomain: "store-1.myshopify.com",
      products: [],
    });
    assert.equal(interceptedUrl, "/api/auto-seo/run", "AutoSeoModuleApiClient targets /api/auto-seo/run");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
