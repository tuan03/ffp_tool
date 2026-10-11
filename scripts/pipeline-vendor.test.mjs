import assert from "node:assert/strict";
import test from "node:test";
import { resolvePipelineVendor } from "./pipeline-vendor.ts";

test("pipeline uses the immutable vendor snapshot, not the store ID", () => {
  assert.equal(resolvePipelineVendor({ vendor: " My Brand ", vendorPolicyVersion: 1 }, "store-id"), "My Brand");
  assert.throws(() => resolvePipelineVendor({ vendorPolicyVersion: 1 }, "store-id"), /STORE_VENDOR_REQUIRED/);
  assert.equal(resolvePipelineVendor({}, "legacy--real"), "LEGACY");
});
