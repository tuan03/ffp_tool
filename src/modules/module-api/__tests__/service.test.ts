import assert from "node:assert/strict";
import test from "node:test";

import {
  getModuleApiRunner,
  runMockModuleApi,
  runModuleApi,
  ShopifyApiError,
  shopifyApiMockData,
} from "..";

test("Module API selects mock runner in mock environment", async () => {
  const runner = getModuleApiRunner("mock");
  assert.equal(runner, runMockModuleApi);
});

test("Module API selects real service runner in development and production environments", async () => {
  assert.equal(getModuleApiRunner("development"), runModuleApi);
  assert.equal(getModuleApiRunner("production"), runModuleApi);
});

test("Module API rejects empty storeId with SHOPIFY_USER_ERROR", async () => {
  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "",
        operation: "connection.test",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );
});

test("Module API mock runner executes connection.test", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "connection.test",
    payload: {},
  });

  assert.equal(response.storeId, "store-101");
  assert.equal(response.operation, "connection.test");
  assert.equal(response.success, true);
  assert.equal(response.data.connected, true);
  assert.equal(response.data.currencyCode, "USD");
  assert.equal(response.data.shopDomain, "quickstart-demo.myshopify.com");
});

test("Module API mock runner executes products.list with filtering", async () => {
  const allResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: {},
  });

  assert.equal(allResponse.success, true);
  assert.equal(allResponse.data.products.length, 3);
  assert.ok(allResponse.data.pageInfo);

  const activeResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: { status: "ACTIVE" },
  });

  assert.equal(activeResponse.data.products.length, 2);
  assert.ok(activeResponse.data.products.every((p) => p.status === "ACTIVE"));

  const filteredResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: { query: "Coffee" },
  });

  assert.equal(filteredResponse.data.products.length, 1);
  assert.equal(filteredResponse.data.products[0]?.title, "Ceramic Coffee Mug");
});

test("Module API mock runner executes products.get", async () => {
  const foundResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.get",
    payload: { id: "gid://shopify/Product/1001" },
  });

  assert.equal(foundResponse.success, true);
  assert.notEqual(foundResponse.data.product, null);
  assert.equal(foundResponse.data.product?.title, "Classic Cotton T-Shirt");

  const notFoundResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.get",
    payload: { id: "gid://shopify/Product/non-existent" },
  });

  assert.equal(notFoundResponse.data.product, null);
});

test("Module API mock runner executes products.create", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.create",
    payload: {
      product: {
        title: "New Graphic Hoodie",
        vendor: "Acme Apparel",
        tags: ["hoodie", "winter"],
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.product.title, "New Graphic Hoodie");
  assert.equal(response.data.product.vendor, "Acme Apparel");
  assert.ok(response.data.product.id.startsWith("gid://shopify/Product/"));
  assert.equal(response.data.product.variants.length, 1);
});

test("Module API mock runner executes products.update", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.update",
    payload: {
      id: "gid://shopify/Product/1001",
      product: {
        title: "Updated Cotton T-Shirt",
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.product.id, "gid://shopify/Product/1001");
  assert.equal(response.data.product.title, "Updated Cotton T-Shirt");
});

test("Module API mock runner executes products.bulkUpdate", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.bulkUpdate",
    payload: {
      products: [
        { id: "gid://shopify/Product/1001", product: { title: "P1 Updated" } },
        { id: "gid://shopify/Product/1002", product: { title: "P2 Updated" } },
      ],
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.count, 2);
  assert.deepEqual(response.data.updatedProductIds, [
    "gid://shopify/Product/1001",
    "gid://shopify/Product/1002",
  ]);
});

test("Module API mock runner executes products.delete", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.delete",
    payload: { id: "gid://shopify/Product/1001" },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.deletedProductId, "gid://shopify/Product/1001");
});

test("Module API mock runner executes variants.update", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "variants.update",
    payload: {
      id: "gid://shopify/ProductVariant/2001",
      variant: {
        price: "29.99",
        inventoryQuantity: 50,
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.variant.id, "gid://shopify/ProductVariant/2001");
  assert.equal(response.data.variant.price, "29.99");
  assert.equal(response.data.variant.inventoryQuantity, 50);
});

test("Module API mock runner executes variants.bulkUpdate", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "variants.bulkUpdate",
    payload: {
      variants: [
        { id: "gid://shopify/ProductVariant/2001", variant: { price: "27.50" } },
        { id: "gid://shopify/ProductVariant/2002", variant: { price: "27.50" } },
      ],
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.count, 2);
  assert.deepEqual(response.data.updatedVariantIds, [
    "gid://shopify/ProductVariant/2001",
    "gid://shopify/ProductVariant/2002",
  ]);
});

test("Module API mock runner executes collections.list and collections.get", async () => {
  const listResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.list",
    payload: {},
  });

  assert.equal(listResponse.success, true);
  assert.equal(listResponse.data.collections.length, 2);

  const getResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.get",
    payload: { id: "gid://shopify/Collection/3001" },
  });

  assert.equal(getResponse.success, true);
  assert.notEqual(getResponse.data.collection, null);
  assert.equal(getResponse.data.collection?.title, "Summer Collection");
});

test("Module API mock runner executes collections.create, update, delete, and updateMembership", async () => {
  const createResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.create",
    payload: {
      collection: {
        title: "New Arrivals",
      },
    },
  });
  assert.equal(createResponse.data.collection.title, "New Arrivals");

  const updateResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.update",
    payload: {
      id: "gid://shopify/Collection/3001",
      collection: {
        title: "Summer 2025 Sale",
      },
    },
  });
  assert.equal(updateResponse.data.collection.title, "Summer 2025 Sale");

  const deleteResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.delete",
    payload: { id: "gid://shopify/Collection/3001" },
  });
  assert.equal(deleteResponse.data.deletedCollectionId, "gid://shopify/Collection/3001");

  const membershipResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.updateMembership",
    payload: {
      collectionId: "gid://shopify/Collection/3002",
      productIdsToAdd: ["gid://shopify/Product/1001"],
      productIdsToRemove: ["gid://shopify/Product/1002"],
    },
  });
  assert.equal(membershipResponse.data.collectionId, "gid://shopify/Collection/3002");
  assert.equal(membershipResponse.data.addedCount, 1);
  assert.equal(membershipResponse.data.removedCount, 1);
});

test("Module API mock runner returns isolated copies that do not mutate fixtures", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: {},
  });

  assert.notEqual(response.data.products, shopifyApiMockData.products);
  assert.notEqual(response.data.products[0], shopifyApiMockData.products[0]);
  assert.notEqual(response.data.products[0]?.variants, shopifyApiMockData.products[0]?.variants);
});

test("Module API mock runner simulates domain errors via storeId hooks", async () => {
  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "simulate-auth-failure",
        operation: "connection.test",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_AUTH_FAILED");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "simulate-throttled",
        operation: "products.list",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_THROTTLED");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "simulate-network-error",
        operation: "products.list",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "simulate-unknown-state",
        operation: "products.delete",
        payload: { id: "gid://shopify/Product/1001" },
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
      return true;
    },
  );
});

test("Module API real service fails predictably when unconfigured", async () => {
  await assert.rejects(
    async () => {
      await runModuleApi({
        storeId: "",
        operation: "connection.test",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runModuleApi({
        storeId: "store-real-1",
        operation: "connection.test",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );
});
