import assert from "node:assert/strict";
import test from "node:test";
import { createModuleApiRunner } from "../service";
import { runMockModuleApi } from "../mocks/runner";

test("Variant limits use the read API without a write request ID and mocks satisfy the same contract", async () => {
  const runner = createModuleApiRunner({ gatewayUrl: "https://gateway.example/api/shopify" }, { fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.operation, "products.variantLimits");
    assert.equal(body.storeId, "example");
    return new Response(JSON.stringify({success:true,storeId:"example",operation:body.operation,data:{maxProductOptions:3,maxProductVariants:2048}}));
  } });
  for (const service of [runner, runMockModuleApi]) {
    const response = await service({operation:"products.variantLimits",storeId:"example"});
    assert.equal(response.data.maxProductOptions,3);
    assert.equal(response.data.maxProductVariants,2048);
  }
});
