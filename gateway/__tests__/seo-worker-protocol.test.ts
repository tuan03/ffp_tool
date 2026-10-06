import assert from "node:assert/strict";
import { test } from "node:test";

import { getWorkerProductKey, getRetryDelay, validateTargetCount, WORKER_DEFAULTS } from "../seo-worker/protocol";

test("worker identity uses the Shopify product ID across source types, never title or handle", () => {
  assert.equal(getWorkerProductKey({ source: "auto_seo", sourceIdentity: "gid://shopify/Product/123" }), "shopify:123");
  assert.equal(getWorkerProductKey({ source: "amazon", sourceIdentity: "asin", productId: "123" }), "shopify:123");
  assert.equal(getWorkerProductKey({ source: "amazon", sourceIdentity: "asin" }), "source:amazon:asin");
  assert.throws(() => getWorkerProductKey({ source: "amazon", sourceIdentity: "" }), /INVALID_SOURCE/);
});

test("worker retry is bounded and run targets count successful drafts only", () => {
  assert.equal(WORKER_DEFAULTS.leaseMs, 600_000);
  assert.equal(WORKER_DEFAULTS.tokenMs, 86_400_000);
  assert.equal(getRetryDelay(1, 0), 30_000);
  assert.equal(getRetryDelay(5, 1), 600_000);
  assert.equal(Number.isSafeInteger(getRetryDelay(1, 0.123456789)), true);
  assert.equal(validateTargetCount(200), 200);
  for (const invalid of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => validateTargetCount(invalid), /INVALID_TARGET/);
});
