import assert from "node:assert/strict";
import test from "node:test";

import { createShopifyGatewayAdapter } from "../../module-api/gateway-adapter";
import type { ModuleApiRunner, ShopifyApiInput } from "../../module-api";
import { syncSingleProduct, type ShopifySyncProductInput, type ShopifyGateway } from "../index";

const SAMPLE_PRODUCT_INPUT: ShopifySyncProductInput = {
  id: "prod-seo-100",
  title: "Optimized Linen Shirt",
  descriptionHtml: "<p>Premium breathable linen shirt</p>",
  handle: "optimized-linen-shirt",
  amazonAsin: "B0GQ33XWW7",
  amazonParentAsin: "B0GQ33XWW7",
  seo: {
    title: "Optimized Linen Shirt - Premium Quality",
    description: "Discover our premium breathable linen shirt.",
  },
};

test("Optimistic Concurrency: mismatch between sourceShopifyUpdatedAt and currentShopifyUpdatedAt flags SHOPIFY_VERSION_CONFLICT", async () => {
  const fakeRunner = (async (request: ShopifyApiInput) => {
    if (request.operation === "products.get") {
      return {
        storeId: request.storeId || "test-store",
        operation: "products.get",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/12345",
            title: "Original Linen Shirt in Shopify Admin",
            handle: "original-linen-shirt",
            descriptionHtml: "<p>Original manual edits in admin</p>",
            tags: ["apparel", "linen"],
            updatedAt: "2026-09-28T12:00:00Z", // modified later in admin!
            seo: {
              title: "Original Title",
              description: "Original Description",
            },
          },
        },
      };
    }
    if (request.operation === "products.update") {
      return {
        storeId: request.storeId || "test-store",
        operation: "products.update",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/12345",
            title: "Updated",
            handle: "optimized-linen-shirt",
            tags: ["apparel"],
            updatedAt: "2026-09-28T13:00:00Z",
          },
        },
      };
    }
    throw new Error(`Unexpected operation: ${request.operation}`);
  });

  const gateway = createShopifyGatewayAdapter("test-store", {
    runner: fakeRunner as unknown as ModuleApiRunner,
  });

  // Source SEO content was generated at 10:00, but Shopify product was updated at 12:00
  const result = await syncSingleProduct(SAMPLE_PRODUCT_INPUT, {
    gateway,
    existingProductId: "gid://shopify/Product/12345",
    sourceShopifyUpdatedAt: "2026-09-28T10:00:00Z",
    force: false,
  });

  assert.equal(result.success, false, "Product sync must fail on version mismatch when force is false");
  assert.ok(result.error?.includes("Shopify product version conflict"), "Error message should mention version conflict");

  const details = result.details as Record<string, unknown> | undefined;
  assert.ok(details, "Result details must be populated");
  assert.equal(details.code, "SHOPIFY_VERSION_CONFLICT");
  assert.equal(details.sourceShopifyUpdatedAt, "2026-09-28T10:00:00Z");
  assert.equal(details.currentShopifyUpdatedAt, "2026-09-28T12:00:00Z");

  const currentProd = details.currentProduct as Record<string, unknown> | undefined;
  assert.equal(currentProd?.title, "Original Linen Shirt in Shopify Admin");
  assert.equal(currentProd?.handle, "original-linen-shirt");
});

test("Optimistic Concurrency: matching timestamps proceeds with product update successfully", async () => {
  let updateCalled = false;

  const fakeRunner = (async (request: ShopifyApiInput) => {
    if (request.operation === "products.get") {
      return {
        storeId: request.storeId || "test-store",
        operation: "products.get",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/12345",
            title: "Linen Shirt",
            handle: "linen-shirt",
            tags: ["apparel"],
            updatedAt: "2026-09-28T10:00:00Z", // matches source timestamp!
          },
        },
      };
    }
    if (request.operation === "products.update") {
      updateCalled = true;
      return {
        storeId: request.storeId || "test-store",
        operation: "products.update",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/12345",
            title: "Optimized Linen Shirt",
            handle: "optimized-linen-shirt",
            tags: ["apparel"],
            updatedAt: "2026-09-28T10:30:00Z",
          },
        },
      };
    }
    if (request.operation === "metafields.set") {
      return {
        storeId: request.storeId || "test-store",
        operation: "metafields.set",
        success: true,
        data: { success: true, metafieldId: "gid://shopify/Metafield/meta-1" },
      };
    }
    throw new Error(`Unexpected operation: ${request.operation}`);
  });

  const gateway = createShopifyGatewayAdapter("test-store", {
    runner: fakeRunner as unknown as ModuleApiRunner,
  });

  const result = await syncSingleProduct(SAMPLE_PRODUCT_INPUT, {
    gateway,
    existingProductId: "gid://shopify/Product/12345",
    sourceShopifyUpdatedAt: "2026-09-28T10:00:00Z",
    force: false,
  });

  assert.equal(result.success, true, "Product sync should succeed when timestamps match");
  assert.equal(updateCalled, true, "products.update must be executed");
  assert.equal(result.productId, "gid://shopify/Product/12345");
});

test("Optimistic Concurrency: force: true overwrites version mismatch", async () => {
  let updateCalled = false;

  const fakeRunner = (async (request: ShopifyApiInput) => {
    if (request.operation === "products.get") {
      return {
        storeId: request.storeId || "test-store",
        operation: "products.get",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/12345",
            title: "Changed by another operator",
            handle: "changed-handle",
            tags: ["apparel"],
            updatedAt: "2026-09-28T14:00:00Z", // mismatch!
          },
        },
      };
    }
    if (request.operation === "products.update") {
      updateCalled = true;
      return {
        storeId: request.storeId || "test-store",
        operation: "products.update",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/12345",
            title: "Optimized Linen Shirt",
            handle: "optimized-linen-shirt",
            tags: ["apparel"],
            updatedAt: "2026-09-28T14:05:00Z",
          },
        },
      };
    }
    if (request.operation === "metafields.set") {
      return {
        storeId: request.storeId || "test-store",
        operation: "metafields.set",
        success: true,
        data: { success: true, metafieldId: "gid://shopify/Metafield/meta-1" },
      };
    }
    throw new Error(`Unexpected operation: ${request.operation}`);
  });

  const gateway = createShopifyGatewayAdapter("test-store", {
    runner: fakeRunner as unknown as ModuleApiRunner,
  });

  const result = await syncSingleProduct(SAMPLE_PRODUCT_INPUT, {
    gateway,
    existingProductId: "gid://shopify/Product/12345",
    sourceShopifyUpdatedAt: "2026-09-28T10:00:00Z", // mismatch with 14:00:00Z
    force: true, // explicit override!
  });

  assert.equal(result.success, true, "force: true must allow sync to succeed despite version mismatch");
  assert.equal(updateCalled, true, "products.update must be executed when force is true");
});

test("Direct GatewayAdapter updateProduct throws SHOPIFY_VERSION_CONFLICT with full conflict details", async () => {
  const fakeRunner = (async (request: ShopifyApiInput) => {
    if (request.operation === "products.get") {
      return {
        storeId: "test-store",
        operation: "products.get",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/999",
            title: "Current Admin Title",
            handle: "current-admin-handle",
            updatedAt: "2026-09-28T15:00:00Z",
            seo: {
              title: "Current SEO Title",
              description: "Current SEO Desc",
            },
          },
        },
      };
    }
    throw new Error(`Unexpected operation: ${request.operation}`);
  });

  const adapter = createShopifyGatewayAdapter("test-store", {
    runner: fakeRunner as unknown as ModuleApiRunner,
  });
  assert.ok(adapter.updateProduct);

  await assert.rejects(
    async () => {
      await adapter.updateProduct!({
        productId: "gid://shopify/Product/999",
        title: "Proposed Title",
        descriptionHtml: "<p>Proposed</p>",
        expectedUpdatedAt: "2026-09-28T11:00:00Z",
        force: false,
      });
    },
    (err: unknown) => {
      assert.ok(err && typeof err === "object");
      const errObj = err as Record<string, unknown>;
      assert.equal(errObj.code, "SHOPIFY_VERSION_CONFLICT");
      const details = errObj.details as Record<string, unknown>;
      assert.equal(details.productId, "gid://shopify/Product/999");
      assert.equal(details.sourceShopifyUpdatedAt, "2026-09-28T11:00:00Z");
      assert.equal(details.currentShopifyUpdatedAt, "2026-09-28T15:00:00Z");
      return true;
    },
  );
});
