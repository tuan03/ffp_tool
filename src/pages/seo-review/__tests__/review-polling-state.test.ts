import assert from "node:assert/strict";
import test from "node:test";

import { mergeCrawlerReviewPollingState } from "../review-polling-state";
import type { SeoProductUiViewModel } from "../types";

function product(
  overrides: Partial<SeoProductUiViewModel>,
): SeoProductUiViewModel {
  return {
    id: "review-1",
    storeId: "preaureum",
    productId: "product-1",
    handle: { value: "test-product", source: "real" },
    productTitle: { value: "Test product", source: "real" },
    productDescription: { value: "", source: "real" },
    seoTitle: { value: "", source: "real" },
    seoDescription: { value: "", source: "real" },
    images: [],
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "approved",
    shopifySyncStatus: "idle",
    isSyncing: false,
    isReverting: false,
    updatedAt: 1,
    ...overrides,
  };
}

test("server synced state clears an optimistic syncing spinner", () => {
  const existing = product({ isSyncing: true, shopifySyncStatus: "syncing" });
  const fresh = product({ isSyncing: false, shopifySyncStatus: "synced", updatedAt: 2 });

  assert.deepEqual(mergeCrawlerReviewPollingState(existing, fresh), fresh);
});

test("an older idle poll does not clear an optimistic syncing spinner", () => {
  const existing = product({ isSyncing: true, shopifySyncStatus: "syncing" });
  const fresh = product({ isSyncing: false, shopifySyncStatus: "idle", updatedAt: 2 });

  const merged = mergeCrawlerReviewPollingState(existing, fresh);
  assert.equal(merged.isSyncing, true);
  assert.equal(merged.shopifySyncStatus, "syncing");
});
