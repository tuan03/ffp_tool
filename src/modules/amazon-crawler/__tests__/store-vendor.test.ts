import assert from "node:assert/strict";
import test from "node:test";

import { createAmazonCrawlerJobController, getAmazonCrawlerJobController } from "..";
import { createCrawlerOperatorFetch } from "../service";

test("store vendor client loads and saves with an encoded store ID", async () => {
  const requests: string[] = [];
  const controller = createAmazonCrawlerJobController({ engineUrl: "http://localhost:8766", fetchImplementation: async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    return Response.json({ storeId: "brand--real", vendor: init?.body ? "My Brand" : null, updatedAt: null });
  } });
  assert.ok(controller.storeVendors);
  assert.equal((await controller.storeVendors.get("brand--real")).vendor, null);
  assert.equal((await controller.storeVendors.save("brand--real", " My Brand ")).vendor, "My Brand");
  await assert.rejects(controller.storeVendors.save("brand--real", ""));
  assert.deepEqual(requests, ["GET http://localhost:8766/api/v1/store-vendors/brand--real", "PUT http://localhost:8766/api/v1/store-vendors/brand--real"]);
});

test("mock store vendors stay isolated per store and return fresh values", async () => {
  const controller = getAmazonCrawlerJobController("mock", "");
  assert.ok(controller.storeVendors);
  await controller.storeVendors.save("brand-a", "Brand A");
  assert.equal((await controller.storeVendors.get("brand-a")).vendor, "Brand A");
  assert.notEqual((await controller.storeVendors.get("brand-b")).vendor, "Brand A");
});

test("vendor configuration uses the scoped operator transport and rejects mismatched stores", async () => {
  const authorizedFetch = createCrawlerOperatorFetch({ engineUrl: "http://localhost:8766", username: "operator", password: "fixture-secret", fetchImplementation: async (_url, init) => {
    assert.ok(new Headers(init?.headers).get("Authorization")?.startsWith("Basic "));
    return Response.json({ storeId: "wrong-store", vendor: "Brand", updatedAt: null });
  } });
  const controller = createAmazonCrawlerJobController({ engineUrl: "http://localhost:8766", fetchImplementation: authorizedFetch });
  assert.ok(controller.storeVendors);
  await assert.rejects(controller.storeVendors.get("brand-a"), /Vendor/);
});
