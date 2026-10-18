import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("pipeline uses the validated product parent for its checksum and never overrides it with input ASIN", () => {
  const source = readFileSync(new URL("./shopify-pipeline-worker.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /amazonParentAsin:\s*claim\.inputAsin/);
  assert.match(source, /AMAZON_METAFIELD_SCHEMA_VERSION = 3/);
  const parentCheckpoint = source.indexOf("amazonParentAsin: preflightInput.amazonParentAsin");
  const noOpCheck = source.indexOf("const isNoOp = Boolean(existingProductId && lastSyncedChecksum === finalChecksum)");
  assert.ok(parentCheckpoint >= 0 && parentCheckpoint < noOpCheck);
});
