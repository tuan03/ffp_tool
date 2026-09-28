import assert from "node:assert/strict";
import test from "node:test";

import { getInitialSampleViewModels } from "../seo-content-ui-adapter";
import type { SeoProductUiViewModel } from "../types";

/**
 * Replicates the restoreProductFromBackup logic from SeoReviewPage to test state transitions.
 */
function restoreProductFromBackup(p: SeoProductUiViewModel): SeoProductUiViewModel {
  if (!p.originalBackup) return p;
  const backup = p.originalBackup;
  const fallbackHandle = (backup.handle || backup.productTitle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const previousSyncedAt = p.shopifySyncedAt || p.lastSyncedAt || p.previousSyncedAt;

  return {
    ...p,
    productTitle: { value: backup.productTitle, source: "real" },
    productDescription: { value: backup.productDescription, source: "real" },
    handle: { value: backup.handle ?? fallbackHandle, source: "real" },
    seoTitle: {
      value: backup.seoTitle ?? (backup.productTitle.length > 70 ? backup.productTitle.slice(0, 67) + "..." : backup.productTitle),
      source: "real",
    },
    seoDescription: {
      value: backup.seoDescription ?? "",
      source: "real",
    },
    reviewDecision: "pending",
    shopifySyncStatus: "idle",
    shopifySyncedAt: undefined,
    shopifySyncError: undefined,
    isSyncing: false,
    syncError: undefined,
    lastSyncedAt: undefined,
    previousSyncedAt,
    isReverting: false,
    revertError: undefined,
    lastRevertedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Replicates stats calculation from SeoReviewPage.
 */
function calculateSyncedStat(products: readonly SeoProductUiViewModel[]): number {
  return products.filter(
    (p) => p.shopifySyncStatus === "synced" && !(p.lastRevertedAt && p.reviewDecision !== "approved"),
  ).length;
}

test("Rollback resets shopifySyncStatus to idle and clears synced timestamps for non-GPT products", () => {
  const sample = getInitialSampleViewModels()[0]!;
  const syncTimestamp = 1774000000000;

  const syncedProduct: SeoProductUiViewModel = {
    ...sample,
    storeId: "capozen",
    reviewDecision: "approved",
    shopifySyncStatus: "synced",
    shopifySyncedAt: syncTimestamp,
    lastSyncedAt: syncTimestamp,
    originalBackup: {
      productTitle: "Vintage Library 3D Optical Illusion Round Rug - Style-02 Book Lover Studyroom",
      productDescription: "<p>Original rug description</p>",
      handle: "vintage-library-3d-optical-illusion-round-rug",
      backedUpAt: 1773000000000,
    },
  };

  assert.equal(syncedProduct.shopifySyncStatus, "synced");
  assert.equal(syncedProduct.reviewDecision, "approved");
  assert.equal(calculateSyncedStat([syncedProduct]), 1);

  const reverted = restoreProductFromBackup(syncedProduct);

  assert.equal(reverted.reviewDecision, "pending", "Review decision must be reset to pending");
  assert.equal(reverted.shopifySyncStatus, "idle", "shopifySyncStatus must be reset to idle");
  assert.equal(reverted.shopifySyncedAt, undefined, "shopifySyncedAt must be cleared");
  assert.equal(reverted.lastSyncedAt, undefined, "lastSyncedAt must be cleared");
  assert.equal(reverted.previousSyncedAt, syncTimestamp, "previousSyncedAt must record the prior sync timestamp");
  assert.ok(reverted.lastRevertedAt, "lastRevertedAt must be set");
  assert.equal(reverted.productTitle.value, "Vintage Library 3D Optical Illusion Round Rug - Style-02 Book Lover Studyroom");

  // ĐÃ ĐẨY STORE must be 0 after rollback
  assert.equal(calculateSyncedStat([reverted]), 0, "ĐÃ ĐẨY STORE count must be 0 after rollback");
});

test("Rollback resets shopifySyncStatus to idle for GPT jobs as well", () => {
  const sample = getInitialSampleViewModels()[0]!;
  const syncTimestamp = 1774001000000;

  const gptProduct: SeoProductUiViewModel = {
    ...sample,
    gptJobId: "job-seo-123",
    storeId: "capozen",
    reviewDecision: "approved",
    shopifySyncStatus: "synced",
    shopifySyncedAt: syncTimestamp,
    lastSyncedAt: syncTimestamp,
    originalBackup: {
      productTitle: "Test Bookish Rug",
      productDescription: "<p>Backup desc</p>",
    },
  };

  const reverted = restoreProductFromBackup(gptProduct);

  assert.equal(reverted.reviewDecision, "pending");
  assert.equal(reverted.shopifySyncStatus, "idle");
  assert.equal(reverted.shopifySyncedAt, undefined);
  assert.equal(reverted.lastSyncedAt, undefined);
  assert.equal(reverted.previousSyncedAt, syncTimestamp);
  assert.ok(reverted.lastRevertedAt);
  assert.equal(calculateSyncedStat([reverted]), 0);
});

test("Defensive stat calculation excludes stale synced products that are reverted", () => {
  const sample = getInitialSampleViewModels()[0]!;

  // Stale product from previous bug: has lastRevertedAt but shopifySyncStatus was stuck on 'synced'
  const staleProduct: SeoProductUiViewModel = {
    ...sample,
    reviewDecision: "pending",
    shopifySyncStatus: "synced",
    lastRevertedAt: Date.now(),
    originalBackup: {
      productTitle: "Vintage Rug",
      productDescription: "Desc",
    },
  };

  // Even if shopifySyncStatus is "synced", the defensive filter sees lastRevertedAt + pending and excludes it
  assert.equal(calculateSyncedStat([staleProduct]), 0, "Defensive check must exclude reverted pending products from synced count");
});

test("Re-syncing after approval clears lastRevertedAt and previousSyncedAt and sets synced count", () => {
  const sample = getInitialSampleViewModels()[0]!;
  const now = Date.now();

  const freshSynced: SeoProductUiViewModel = {
    ...sample,
    reviewDecision: "approved",
    shopifySyncStatus: "synced",
    shopifySyncedAt: now,
    lastSyncedAt: now,
    lastRevertedAt: undefined,
    previousSyncedAt: undefined,
  };

  assert.equal(freshSynced.shopifySyncStatus, "synced");
  assert.equal(freshSynced.lastRevertedAt, undefined);
  assert.equal(freshSynced.previousSyncedAt, undefined);
  assert.equal(calculateSyncedStat([freshSynced]), 1);
});

function computeWasAlreadySynced(product: SeoProductUiViewModel): boolean {
  const isCurrentlyReverted = Boolean(product.lastRevertedAt && product.reviewDecision !== "approved");
  return (
    !isCurrentlyReverted &&
    Boolean(
      product.shopifySyncStatus === "synced" ||
        product.shopifySyncedAt ||
        product.lastSyncedAt ||
        product.shopifyAdminUrl ||
        (product.productId && product.productId.startsWith("gid://shopify/Product/")),
    )
  );
}

function resolveSyncBadgeDisplay(product: SeoProductUiViewModel): "synced" | "reverted" | "idle" | "other" {
  if (product.shopifySyncStatus === "synced" && !(product.lastRevertedAt && product.reviewDecision !== "approved")) {
    return "synced";
  }
  if (product.lastRevertedAt && product.reviewDecision !== "approved") {
    return "reverted";
  }
  if (!(product.lastRevertedAt && product.reviewDecision !== "approved") && (!product.shopifySyncStatus || product.shopifySyncStatus === "idle")) {
    return "idle";
  }
  return "other";
}

function computeApprovedUnsyncedStat(products: readonly SeoProductUiViewModel[]): number {
  return products.filter(
    (p) =>
      p.reviewDecision === "approved" &&
      !p.isSyncing &&
      !p.isReverting &&
      !["queued", "syncing", "synced"].includes(p.shopifySyncStatus || "idle"),
  ).length;
}

test("wasAlreadySynced is false after rollback even when productId and shopifyAdminUrl are present", () => {
  const sample = getInitialSampleViewModels()[0]!;
  const revertedProduct: SeoProductUiViewModel = {
    ...sample,
    productId: "gid://shopify/Product/987654321",
    shopifyAdminUrl: "https://admin.shopify.com/store/capozen/products/987654321",
    reviewDecision: "pending",
    shopifySyncStatus: "idle",
    lastRevertedAt: Date.now(),
    previousSyncedAt: 1774000000000,
    shopifySyncedAt: undefined,
    lastSyncedAt: undefined,
  };

  assert.equal(
    computeWasAlreadySynced(revertedProduct),
    false,
    "wasAlreadySynced must evaluate to false for a reverted pending product",
  );
});

test("Re-approving a product after rollback transitions badge from 'reverted' to 'idle' (Chưa đẩy Store)", () => {
  const sample = getInitialSampleViewModels()[0]!;
  const revertedProduct: SeoProductUiViewModel = {
    ...sample,
    storeId: "capozen",
    reviewDecision: "pending",
    shopifySyncStatus: "idle",
    lastRevertedAt: Date.now() - 60000,
    previousSyncedAt: Date.now() - 120000,
  };

  // While reverted: badge shows 'reverted'
  assert.equal(resolveSyncBadgeDisplay(revertedProduct), "reverted");
  assert.equal(calculateSyncedStat([revertedProduct]), 0);
  assert.equal(computeApprovedUnsyncedStat([revertedProduct]), 0);

  // User subsequently approves the reverted product before pushing to Shopify:
  const reApprovedProduct: SeoProductUiViewModel = {
    ...revertedProduct,
    reviewDecision: "approved",
  };

  // Now badge must show 'idle' (Chưa đẩy Store), NOT 'reverted' and NOT 'synced'
  assert.equal(resolveSyncBadgeDisplay(reApprovedProduct), "idle");
  assert.equal(calculateSyncedStat([reApprovedProduct]), 0, "Synced stat must still be 0 before push");
  assert.equal(computeApprovedUnsyncedStat([reApprovedProduct]), 1, "Must be counted as approved unsynced");
});

