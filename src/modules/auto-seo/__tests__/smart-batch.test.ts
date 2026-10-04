import assert from "node:assert/strict";
import test from "node:test";

import type {
  AutoSeoEligibilityItem,
  ShopifyProductForAutoSeoUi,
} from "../types";
import { selectNextAutoSeoBatch, selectSeoRevisionJobs } from "../ui/smart-batch";

function product(id: string, updatedAt?: string): ShopifyProductForAutoSeoUi {
  return { id, title: id, handle: id, ...(updatedAt ? { updatedAt } : {}) };
}

function eligibility(
  productId: string,
  state: AutoSeoEligibilityItem["state"],
): AutoSeoEligibilityItem {
  return {
    productId,
    state,
    reason: state === "never_processed" ? "NO_HISTORY" : "SHOPIFY_UPDATED",
  };
}

test("smart batch prioritizes never processed, then changed/retry, newest first", () => {
  const products = [
    product("changed-new", "2026-10-01T12:00:00Z"),
    product("never-old", "2025-01-01T00:00:00Z"),
    product("retry-newest", "2026-10-02T00:00:00Z"),
    product("never-new", "2026-01-01T00:00:00Z"),
    product("current", "2027-01-01T00:00:00Z"),
    product("active", "2027-01-02T00:00:00Z"),
  ];
  const items = [
    eligibility("changed-new", "changed"),
    eligibility("never-old", "never_processed"),
    eligibility("retry-newest", "retry"),
    eligibility("never-new", "never_processed"),
    eligibility("current", "current"),
    eligibility("active", "active"),
  ];

  assert.deepEqual(selectNextAutoSeoBatch(products, items, 10), [
    "never-new",
    "never-old",
    "retry-newest",
    "changed-new",
  ]);
});

test("smart batch is deterministic for invalid timestamps and duplicate inputs", () => {
  const products = [
    product("b", "invalid"),
    product("a"),
    product("b", "2026-01-01T00:00:00Z"),
  ];
  const items = [eligibility("b", "changed"), eligibility("a", "changed")];

  assert.deepEqual(selectNextAutoSeoBatch(products, items, 10), ["a", "b"]);
  assert.deepEqual(selectNextAutoSeoBatch(products, items, 10), ["a", "b"]);
});

test("smart batch honors every supported batch cap", () => {
  const products = Array.from({ length: 120 }, (_, index) =>
    product(`p-${String(index).padStart(3, "0")}`, "2026-01-01T00:00:00Z"));
  const items = products.map(entry => eligibility(entry.id, "never_processed"));

  for (const size of [10, 20, 50, 100] as const) {
    const selectedIds = selectNextAutoSeoBatch(products, items, size);
    assert.equal(selectedIds.length, size);
    assert.equal(new Set(selectedIds).size, size);
  }
});

test("revision selection includes only synced products with a current job", () => {
  assert.deepEqual(selectSeoRevisionJobs(
    ["synced", "legacy-current", "active", "synced"],
    [
      { productId: "synced", jobId: "job-synced", state: "current", reason: "SHOPIFY_SYNCED" },
      { productId: "synced", jobId: "job-synced", state: "current", reason: "SHOPIFY_SYNCED" },
      { productId: "legacy-current", state: "current", reason: "UP_TO_DATE" },
      { productId: "active", jobId: "job-active", state: "active", reason: "ACTIVE_QUEUE" },
    ],
  ), [{ productId: "synced", jobId: "job-synced" }]);
});
