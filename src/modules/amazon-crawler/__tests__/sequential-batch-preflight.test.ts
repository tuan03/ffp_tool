import assert from "node:assert/strict";
import test from "node:test";

import type { ShopifyAsinFilter } from "../types";
import { prepareSequentialBatch } from "../ui/sequential-batch-preflight";
import { runMockAmazonCrawler } from "../mocks/runner";
import { DEFAULT_AMAZON_CRAWLER_SETTINGS } from "../types";

const filter: ShopifyAsinFilter = async ({ storeId }) => ({
  storeId, scannedProducts: 3,
  matches: [{ asin: "B0CHILD001", productId: "1", title: "Existing", status: "ACTIVE", adminUrl: "" }],
  missingAsins: ["B0CHILD002", "B0CHILD003", "B0CHILD004"],
  activity: [
    { asin: "B0CHILD002", parentAsin: "B0PARENT01", status: "processing" },
    { asin: "B0CHILD003", parentAsin: "B0PARENT01", status: "available" },
    { asin: "B0CHILD004", parentAsin: "B0PARENT01", status: "attention" },
  ],
});

test("batch preflight keeps all unique inputs with exact durable skip reasons, not family-wide skips", async () => {
  const prepared = await prepareSequentialBatch([
    "b0child001", "https://www.amazon.com/dp/B0CHILD001", "B0CHILD002", "B0CHILD003", "B0CHILD004",
  ], "sample", filter);
  assert.deepEqual(prepared.urls, ["B0CHILD001", "B0CHILD002", "B0CHILD003", "B0CHILD004"]);
  assert.equal(prepared.sequentialBatch, true);
  assert.deepEqual(prepared.existingShopifyAsins, ["B0CHILD001"]);
  assert.deepEqual(prepared.batchSkippedInputs, [
    { asin: "B0CHILD001", reason: "existing_shopify" },
    { asin: "B0CHILD002", reason: "existing_pipeline" },
    { asin: "B0CHILD004", reason: "attention" },
  ]);
});

test("batch preflight rejects incomplete or cross-store verification and propagates outages", async () => {
  for (const invalid of [
    { storeId: "other", missingAsins: [], matches: [], scannedProducts: 0 },
    { storeId: "sample", missingAsins: ["B0CHILD001"], matches: [], scannedProducts: 0 },
  ]) {
    await assert.rejects(prepareSequentialBatch(["B0CHILD001"], "sample", async () => invalid));
  }
  await assert.rejects(prepareSequentialBatch(["B0CHILD001"], "sample", async () => { throw new Error("offline"); }), /offline/);
});

test("batch preflight limits 200 unique ASINs before scanning Shopify", async () => {
  let calls = 0;
  await assert.rejects(prepareSequentialBatch(Array.from({ length: 201 }, (_, index) => `B0${String(index).padStart(8, "0")}`),
    "sample", async (input) => { calls++; return filter(input); }), /200/);
  assert.equal(calls, 0);
});

test("mock batch follows exact skips and returns fresh products and progress", async () => {
  const input = { ...DEFAULT_AMAZON_CRAWLER_SETTINGS, sequentialBatch: true, urls: ["B0CHILD001", "B0CHILD002"],
    batchSkippedInputs: [{ asin: "B0CHILD001", reason: "existing_shopify" as const }] };
  let checkedProgress = false;
  const output = await runMockAmazonCrawler({ input, onProgress: progress => {
    assert.equal(progress.batch?.skippedShopify, 1);
    assert.equal(progress.total, 2);
    checkedProgress = true;
  } });
  assert.ok(checkedProgress);
  assert.deepEqual(output.products.map(product => product.asin), ["B0CHILD002"]);
  output.products[0].title = "changed";
  assert.notEqual((await runMockAmazonCrawler({ input })).products[0].title, "changed");
});
