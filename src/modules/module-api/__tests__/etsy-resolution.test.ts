import assert from "node:assert/strict";
import test from "node:test";

import { resolveShopifyProductForSync } from "../gateway-adapter";
import type { ModuleApiRunner, ShopifyApiInput, ShopifyApiResponse } from "../types";

test("Etsy sync cannot create a duplicate when preflight is not ready or rejected", async () => {
  for (const fails of [false, true]) {
    const runner = (async (input: ShopifyApiInput): Promise<ShopifyApiResponse> => {
      if (input.operation === "products.preflightEtsyListings") {
        if (fails) throw new Error("Definition access denied");
        return { success: true, storeId: "test", operation: input.operation, data: { ready: false, matches: [], listings: [], allowedListingIds: [] } };
      }
      return { success: true, storeId: "test", operation: "products.list", data: { products: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } } };
    }) as ModuleApiRunner;
    await assert.rejects(resolveShopifyProductForSync({ runner, storeId: "test", sourceKey: "etsy:1234567890" }));
  }
});

test("Etsy sync preflight carries a fresh apply request ID for each reconciliation", async () => {
  const requests: Extract<ShopifyApiInput, { operation: "products.preflightEtsyListings" }>[] = [];
  const runner = (async (input: ShopifyApiInput): Promise<ShopifyApiResponse> => {
    if (input.operation === "products.preflightEtsyListings") {
      requests.push(input);
      return { success: true, storeId: "test", operation: input.operation, data: {
        ready: true, matches: [], listings: [], allowedListingIds: ["1234567890"],
      } };
    }
    return { success: true, storeId: "test", operation: "products.list", data: { products: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } } };
  }) as ModuleApiRunner;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await resolveShopifyProductForSync({ runner, storeId: "test", sourceKey: "etsy:1234567890" });
    assert.equal(result.match, "none");
  }
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.mode, "apply");
    assert.ok(request.requestId?.trim());
  }
  assert.notEqual(requests[0]?.requestId, requests[1]?.requestId);
});
