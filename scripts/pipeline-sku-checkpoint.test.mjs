import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("pipeline checkpoints include outgoing SKUs before deciding a sync is unchanged", () => {
  const source = readFileSync(new URL("./shopify-pipeline-worker.ts", import.meta.url), "utf8");
  const skuCheckpoint = source.indexOf("variantSkus: preflightInput.variants?.map(variant => variant.sku) ?? []");
  const noOpCheck = source.indexOf("const isNoOp = Boolean(existingProductId && lastSyncedChecksum === finalChecksum)");
  assert.ok(skuCheckpoint >= 0 && skuCheckpoint < noOpCheck);
  assert.match(source.slice(skuCheckpoint - 100, skuCheckpoint), /finalChecksum = checksum\(\{\s*sourceChecksum: finalChecksum,/);
});
