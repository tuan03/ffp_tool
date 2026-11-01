import assert from "node:assert/strict";
import test from "node:test";

import { createShopifyGatewayAdapter } from "../gateway-adapter";
import type { ModuleApiRunner, ShopifyApiInput, ShopifyApiResponse } from "../types";

for (const strategy of ["prefix", "callback"] as const) {
  test(`Variant metafield writes and deletes have stable owner-specific IDs with a ${strategy}`, async () => {
    const requests: ShopifyApiInput[] = [];
    const payloads = new Map<string, string>();
    const runner = (async (input: ShopifyApiInput): Promise<ShopifyApiResponse> => {
      assert.ok(input.operation === "metafields.set" || input.operation === "metafields.delete");
      const requestId = input.requestId ?? "";
      assert.ok(requestId);
      const payload = JSON.stringify(input.payload);
      if (payloads.has(requestId)) {
        assert.equal(payloads.get(requestId), payload, "An idempotency ID must not be reused for another owner");
      }
      payloads.set(requestId, payload);
      requests.push(input);
      if (input.operation === "metafields.set") {
        return { success: true, storeId: "test", operation: input.operation,
          data: { success: true, metafields: [] } };
      }
      return { success: true, storeId: "test", operation: input.operation,
        data: { success: true, deletedMetafields: [], notFound: [] } };
    }) as ModuleApiRunner;
    const adapter = createShopifyGatewayAdapter("test", {
      runner,
      mode: "apply",
      ...(strategy === "prefix"
        ? { requestId: "sync-fixture" }
        : { getRequestId: (operation: string) => `sync-fixture-${operation}` }),
    });
    const field = {
      productId: "gid://shopify/Product/100",
      namespace: "custom",
      key: "etsy_product_id",
      type: "single_line_text_field" as const,
      value: "1001",
    };
    const owners = ["gid://shopify/ProductVariant/201", "gid://shopify/ProductVariant/202"];
    assert.ok(adapter.deleteProductMetafield);
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const ownerId of owners) {
        await adapter.setProductMetafield({ ...field, ownerId });
        await adapter.deleteProductMetafield({ ...field, ownerId });
      }
    }
    assert.equal(payloads.size, 4, "Each owner and operation has a distinct ID; retries reuse it");
    assert.deepEqual(requests.slice(0, 4), requests.slice(4));

    await adapter.setProductMetafield(field);
    assert.equal(requests.at(-1)?.requestId, "sync-fixture-metafields-set-custom-etsy_product_id");
    await adapter.deleteProductMetafield(field);
    assert.equal(requests.at(-1)?.requestId, "sync-fixture-metafields-delete-custom-etsy_product_id");
  });
}
