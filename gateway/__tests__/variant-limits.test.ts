import assert from "node:assert/strict";
import test from "node:test";
import { executeProductVariantLimits } from "../operations/variant-limits";
import type { StoreConfig } from "../types";

const store: StoreConfig = { storeId: "test", shopDomain: "example.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "fixture" } };
test("Variant limits come from the selected shop and fail closed for incomplete responses", async () => {
  for (const limits of [{ maxProductOptions: 3, maxProductVariants: 100 }, { maxProductOptions: 3, maxProductVariants: 2048 }]) {
    const client = { async query<T>(selected: StoreConfig): Promise<T> {
      assert.equal(selected.storeId, "test");
      return { shop: { resourceLimits: limits } } as T;
    } };
    assert.deepEqual(await executeProductVariantLimits(store, client), limits);
  }
  const client = { async query<T>(): Promise<T> { return { shop: {} } as T; } };
  await assert.rejects(executeProductVariantLimits(store, client), /giới hạn/);
});
