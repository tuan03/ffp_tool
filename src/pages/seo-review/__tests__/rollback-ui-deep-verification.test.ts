import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getInitialSampleViewModels } from "../seo-content-ui-adapter";
import { ProductCardList } from "../components/ProductCardList";
import { ProductListTable } from "../components/ProductListTable";
import { ProductSplitView } from "../components/ProductSplitView";
import { ProductDetailDrawer } from "../components/ProductDetailDrawer";
import { ProductEditModal } from "../components/ProductEditModal";
import type { SeoProductUiViewModel } from "../types";

/**
 * Replicates restoreProductFromBackup from SeoReviewPage.tsx
 */
function restoreProductFromBackup(p: SeoProductUiViewModel): SeoProductUiViewModel {
  if (!p.originalBackup) return p;
  const backup = p.originalBackup;
  const fallbackHandle = (backup.handle || backup.productTitle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const previousSyncedAt =
    p.shopifySyncedAt ||
    p.lastSyncedAt ||
    p.previousSyncedAt ||
    (p.shopifySyncStatus === "synced" ? p.updatedAt || Date.now() : undefined);

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
 * Replicates calculateStats from SeoReviewPage.tsx
 */
function calculateStats(products: readonly SeoProductUiViewModel[]) {
  const total = products.length;
  const completed = products.filter((p) => p.seoStatus.value === "completed").length;
  const pending = products.filter((p) => p.reviewDecision === "pending").length;
  const approved = products.filter((p) => p.reviewDecision === "approved").length;
  const approvedUnsynced = products.filter(
    (p) =>
      p.reviewDecision === "approved" &&
      !p.isSyncing &&
      !p.isReverting &&
      !["queued", "syncing", "synced"].includes(p.shopifySyncStatus || "idle"),
  ).length;
  const rejected = products.filter((p) => p.reviewDecision === "rejected").length;
  const synced = products.filter(
    (p) => p.shopifySyncStatus === "synced" && !(p.lastRevertedAt && p.reviewDecision !== "approved"),
  ).length;
  const syncing = products.filter((p) => p.shopifySyncStatus === "syncing" || p.isSyncing).length;
  const syncFailed = products.filter((p) => p.shopifySyncStatus === "failed").length;

  return { total, completed, pending, approved, approvedUnsynced, rejected, synced, syncing, syncFailed };
}

/**
 * Replicates the polling/subscriber merge logic from SeoReviewPage.tsx
 */
function mergeSubscriberCrawlerProducts(
  current: readonly SeoProductUiViewModel[],
  freshCrawlerProducts: readonly SeoProductUiViewModel[],
): readonly SeoProductUiViewModel[] {
  const currentMap = new Map(current.map((p) => [p.id, p]));
  return freshCrawlerProducts.map((fresh) => {
    const existing = currentMap.get(fresh.id);
    if (!existing) return fresh;

    // In-flight syncing preservation
    if (existing.isSyncing) {
      return { ...fresh, isSyncing: true, shopifySyncStatus: "syncing" as const };
    }
    // In-flight reverting preservation
    if (existing.isReverting) {
      return { ...fresh, isReverting: true };
    }
    // Local rollback preservation
    if (existing.lastRevertedAt && existing.reviewDecision !== "approved") {
      return {
        ...fresh,
        productTitle: existing.productTitle,
        productDescription: existing.productDescription,
        seoTitle: existing.seoTitle,
        seoDescription: existing.seoDescription,
        handle: existing.handle,
        reviewDecision: "pending" as const,
        shopifySyncStatus: "idle" as const,
        shopifySyncedAt: undefined,
        lastSyncedAt: undefined,
        previousSyncedAt: existing.previousSyncedAt,
        lastRevertedAt: existing.lastRevertedAt,
        originalBackup: existing.originalBackup ?? fresh.originalBackup,
        isReverting: false,
      };
    }

    return fresh;
  });
}

/**
 * Replicates the sessionStorage rehydration cleaner from SeoReviewPage.tsx
 */
function rehydrateSessionStorageProducts(rawList: readonly SeoProductUiViewModel[]): readonly SeoProductUiViewModel[] {
  return rawList.map((p) => {
    let updated = p;
    if (updated.isSyncing) updated = { ...updated, isSyncing: false };
    if (updated.isReverting) updated = { ...updated, isReverting: false };
    if (updated.lastRevertedAt && updated.reviewDecision !== "approved" && updated.shopifySyncStatus === "synced") {
      updated = {
        ...updated,
        shopifySyncStatus: "idle" as const,
        previousSyncedAt: updated.shopifySyncedAt || updated.lastSyncedAt || updated.previousSyncedAt,
        shopifySyncedAt: undefined,
        lastSyncedAt: undefined,
      };
    }
    return updated;
  });
}

test("Scenario 1: Exact reproduction of user's reported bug - Before vs After Rollback UI verification", () => {
  const sample = getInitialSampleViewModels()[0]!;
  const syncTimestamp = 1774000000000;

  // 1. Setup exact product state BEFORE rollback:
  // - Title has new SEO content
  // - Approved
  // - Synced to capozen
  const syncedProduct: SeoProductUiViewModel = {
    ...sample,
    id: "prod-capozen-rug-001",
    storeId: "capozen",
    productTitle: {
      value: "Vintage Library 3D Optical Illusion Round Rug - Best Bookish Reading Nook Carpet",
      source: "real",
    },
    seoTitle: {
      value: "Vintage Library 3D Optical Illusion Round Rug | Capozen",
      source: "real",
    },
    reviewDecision: "approved",
    shopifySyncStatus: "synced",
    shopifySyncedAt: syncTimestamp,
    lastSyncedAt: syncTimestamp,
    shopifyAdminUrl: "https://admin.shopify.com/store/capozen/products/123456789",
    originalBackup: {
      productTitle: "Vintage Library 3D Optical Illusion Round Rug - Style-02 Book Lover Studyroom",
      productDescription: "<p>Original rug description from supplier</p>",
      handle: "vintage-library-3d-optical-illusion-round-rug",
      backedUpAt: 1773000000000,
    },
  };

  // VERIFY BEFORE ROLLBACK:
  const beforeStats = calculateStats([syncedProduct]);
  assert.equal(beforeStats.synced, 1, "Before rollback: ĐÃ ĐẨY STORE must be 1");
  assert.equal(beforeStats.approved, 1, "Before rollback: Đã duyệt must be 1");
  assert.equal(beforeStats.pending, 0, "Before rollback: Chờ review must be 0");

  const beforeCardHtml = renderToStaticMarkup(
    createElement(ProductCardList, {
      products: [syncedProduct],
      selectedIds: new Set<string>(),
      currentStoreId: "capozen",
      onToggleSelect: () => undefined,
      onViewProduct: () => undefined,
      onEditProduct: () => undefined,
      onApproveProduct: () => undefined,
      onRejectProduct: () => undefined,
    }),
  );
  assert.match(beforeCardHtml, /Đã đẩy \(capozen\)/, "Before rollback: Card displays 'Đã đẩy (capozen)'");
  assert.doesNotMatch(beforeCardHtml, /Shopify: Đã hoàn tác/, "Before rollback: Card must NOT show 'Shopify: Đã hoàn tác'");

  const beforeDrawerHtml = renderToStaticMarkup(
    createElement(ProductDetailDrawer, {
      product: syncedProduct,
      isOpen: true,
      currentStoreId: "capozen",
      onClose: () => undefined,
      onEdit: () => undefined,
      onApprove: () => undefined,
      onReject: () => undefined,
    }),
  );
  assert.match(beforeDrawerHtml, /ĐÃ PHÊ DUYỆT \(Approved\)/, "Before rollback: Drawer shows Approved");
  assert.match(beforeDrawerHtml, /Đã đẩy \(capozen\)/, "Before rollback: Drawer shows 'Đã đẩy (capozen)'");
  assert.match(beforeDrawerHtml, /Đã đồng bộ lên Shopify thành công/, "Before rollback: Drawer shows sync success banner");

  // 2. USER CLICKS ROLLBACK:
  const rolledBackProduct = restoreProductFromBackup(syncedProduct);

  // VERIFY AFTER ROLLBACK:
  // Title restored to original:
  assert.equal(
    rolledBackProduct.productTitle.value,
    "Vintage Library 3D Optical Illusion Round Rug - Style-02 Book Lover Studyroom",
    "Product title must be restored to original backup",
  );
  // Statuses reset:
  assert.equal(rolledBackProduct.reviewDecision, "pending", "Review decision must be reset to pending");
  assert.equal(rolledBackProduct.shopifySyncStatus, "idle", "shopifySyncStatus must be reset to idle");
  assert.equal(rolledBackProduct.shopifySyncedAt, undefined, "shopifySyncedAt must be cleared");
  assert.equal(rolledBackProduct.lastSyncedAt, undefined, "lastSyncedAt must be cleared");
  assert.equal(rolledBackProduct.previousSyncedAt, syncTimestamp, "previousSyncedAt must preserve the sync timestamp");
  assert.ok(rolledBackProduct.lastRevertedAt, "lastRevertedAt must be recorded");

  // VERIFY STATS:
  const afterStats = calculateStats([rolledBackProduct]);
  assert.equal(afterStats.synced, 0, "After rollback: ĐÃ ĐẨY STORE MUST BE 0 (NOT 1!)");
  assert.equal(afterStats.pending, 1, "After rollback: Chờ review must be 1");
  assert.equal(afterStats.approved, 0, "After rollback: Đã duyệt must be 0");

  // VERIFY ProductCardList RENDERING:
  const afterCardHtml = renderToStaticMarkup(
    createElement(ProductCardList, {
      products: [rolledBackProduct],
      selectedIds: new Set<string>(),
      currentStoreId: "capozen",
      onToggleSelect: () => undefined,
      onViewProduct: () => undefined,
      onEditProduct: () => undefined,
      onApproveProduct: () => undefined,
      onRejectProduct: () => undefined,
    }),
  );
  assert.doesNotMatch(afterCardHtml, /Đã đẩy \(capozen\)/, "After rollback: Card MUST NOT display 'Đã đẩy (capozen)'");
  assert.doesNotMatch(afterCardHtml, /Đã đẩy Store/, "After rollback: Card MUST NOT display 'Đã đẩy Store'");
  assert.match(afterCardHtml, /Shopify: Đã hoàn tác \(capozen\)/, "After rollback: Card MUST display 'Shopify: Đã hoàn tác (capozen)'");
  assert.match(afterCardHtml, /Trạng thái hiện tại: Đã hoàn tác về dữ liệu gốc/, "After rollback: Card displays current reverted state banner");
  assert.match(afterCardHtml, /Lịch sử: Đã từng đồng bộ lên Shopify \(capozen\)/, "After rollback: Card displays separate sync history");

  // VERIFY ProductListTable RENDERING:
  const afterTableHtml = renderToStaticMarkup(
    createElement(ProductListTable, {
      products: [rolledBackProduct],
      selectedIds: new Set<string>(),
      expandedIds: new Set<string>([rolledBackProduct.id]),
      currentStoreId: "capozen",
      onToggleSelect: () => undefined,
      onToggleSelectAll: () => undefined,
      onToggleExpand: () => undefined,
      onViewProduct: () => undefined,
      onEditProduct: () => undefined,
      onApproveProduct: () => undefined,
      onRejectProduct: () => undefined,
    }),
  );
  assert.doesNotMatch(afterTableHtml, /Đã đẩy \(capozen\)/, "After rollback: Table MUST NOT display 'Đã đẩy (capozen)'");
  assert.doesNotMatch(afterTableHtml, /Đã đẩy Store/, "After rollback: Table MUST NOT display 'Đã đẩy Store'");
  assert.match(afterTableHtml, /Shopify: Đã hoàn tác \(capozen\)/, "After rollback: Table MUST display 'Shopify: Đã hoàn tác (capozen)'");
  assert.match(afterTableHtml, /↩ Trạng thái:<\/span> Đã hoàn tác/, "After rollback: Table row shows current reverted state");
  assert.match(afterTableHtml, /Lịch sử sync:/, "After rollback: Table row shows separate history");

  // VERIFY ProductSplitView RENDERING:
  const afterSplitHtml = renderToStaticMarkup(
    createElement(ProductSplitView, {
      products: [rolledBackProduct],
      activeProduct: rolledBackProduct,
      selectedIds: new Set<string>(),
      currentStoreId: "capozen",
      onSelectActive: () => undefined,
      onToggleSelect: () => undefined,
      onViewProduct: () => undefined,
      onApproveProduct: () => undefined,
      onRejectProduct: () => undefined,
      onEditProduct: () => undefined,
      onApproveAndNext: () => undefined,
      onRejectAndNext: () => undefined,
    }),
  );
  assert.doesNotMatch(afterSplitHtml, /Đã đẩy \(capozen\)/, "After rollback: Split view MUST NOT display 'Đã đẩy (capozen)'");
  assert.doesNotMatch(afterSplitHtml, />✓ Synced</, "After rollback: Split view MUST NOT show '✓ Synced'");
  assert.match(afterSplitHtml, /Shopify: Đã hoàn tác \(capozen\)/, "After rollback: Split view MUST show 'Shopify: Đã hoàn tác (capozen)'");
  assert.match(afterSplitHtml, /↩ Đã hoàn tác/, "After rollback: Split view list shows '↩ Đã hoàn tác'");
  assert.match(afterSplitHtml, /Trạng thái hiện tại: Đã hoàn tác về dữ liệu gốc/, "After rollback: Split view inspector displays current reverted state");
  assert.match(afterSplitHtml, /Lịch sử: Từng đồng bộ Shopify lúc/, "After rollback: Split view inspector displays history");

  // VERIFY ProductDetailDrawer RENDERING:
  const afterDrawerHtml = renderToStaticMarkup(
    createElement(ProductDetailDrawer, {
      product: rolledBackProduct,
      isOpen: true,
      currentStoreId: "capozen",
      onClose: () => undefined,
      onEdit: () => undefined,
      onApprove: () => undefined,
      onReject: () => undefined,
    }),
  );
  assert.doesNotMatch(afterDrawerHtml, /ĐÃ PHÊ DUYỆT \(Approved\)/, "After rollback: Drawer MUST NOT display 'ĐÃ PHÊ DUYỆT'");
  assert.doesNotMatch(afterDrawerHtml, /Đã đẩy \(capozen\)/, "After rollback: Drawer MUST NOT display 'Đã đẩy (capozen)'");
  assert.doesNotMatch(afterDrawerHtml, /Đã đồng bộ lên Shopify thành công/, "After rollback: Drawer MUST NOT display sync success banner");
  assert.match(afterDrawerHtml, /CHỜ REVIEW \(Pending\)/, "After rollback: Drawer displays 'CHỜ REVIEW (Pending)'");
  assert.match(afterDrawerHtml, /Shopify: Đã hoàn tác \(capozen\)/, "After rollback: Drawer displays 'Shopify: Đã hoàn tác (capozen)'");
  assert.match(afterDrawerHtml, /Trạng thái hiện tại: Đã hoàn tác về dữ liệu gốc/, "After rollback: Drawer displays current reverted state banner");
  assert.match(afterDrawerHtml, /Lịch sử: Từng đồng bộ Shopify lúc/, "After rollback: Drawer displays separate history line");

  // VERIFY ProductEditModal:
  const editModalHtml = renderToStaticMarkup(
    createElement(ProductEditModal, {
      product: rolledBackProduct,
      isOpen: true,
      onClose: () => undefined,
      onSave: async () => true,
    }),
  );
  assert.doesNotMatch(
    editModalHtml,
    /Cập nhật, Duyệt &amp; Đồng bộ ngay/,
    "After rollback: EditModal must NOT show 'Cập nhật, Duyệt & Đồng bộ ngay'",
  );
  assert.match(
    editModalHtml,
    /Cập nhật &amp; Duyệt ngay/,
    "After rollback: EditModal action button must say 'Cập nhật & Duyệt ngay'",
  );
});

test("Scenario 2: Multi-product isolation test - Reverted item alongside Synced and Pending items", () => {
  const sample = getInitialSampleViewModels()[0]!;

  const syncedItem: SeoProductUiViewModel = {
    ...sample,
    id: "item-1-synced",
    storeId: "capozen",
    productTitle: { value: "Synced Leather Jacket", source: "real" },
    reviewDecision: "approved",
    shopifySyncStatus: "synced",
    shopifySyncedAt: 1774000000000,
    lastSyncedAt: 1774000000000,
  };

  const revertedItem: SeoProductUiViewModel = {
    ...sample,
    id: "item-2-reverted",
    storeId: "capozen",
    productTitle: { value: "Reverted Vintage Rug", source: "real" },
    reviewDecision: "pending",
    shopifySyncStatus: "idle",
    lastRevertedAt: 1774000500000,
    previousSyncedAt: 1774000000000,
    originalBackup: {
      productTitle: "Reverted Vintage Rug Original",
      productDescription: "Original desc",
    },
  };

  const pendingItem: SeoProductUiViewModel = {
    ...sample,
    id: "item-3-fresh-pending",
    storeId: "capozen",
    productTitle: { value: "Fresh Unreviewed Lamp", source: "real" },
    reviewDecision: "pending",
    shopifySyncStatus: "idle",
  };

  const stats = calculateStats([syncedItem, revertedItem, pendingItem]);
  assert.equal(stats.total, 3, "Total items: 3");
  assert.equal(stats.synced, 1, "Only 1 item is synced (the reverted item is excluded!)");
  assert.equal(stats.pending, 2, "2 items are pending review");
  assert.equal(stats.approved, 1, "1 item is approved");

  const cardHtml = renderToStaticMarkup(
    createElement(ProductCardList, {
      products: [syncedItem, revertedItem, pendingItem],
      selectedIds: new Set<string>(),
      currentStoreId: "capozen",
      onToggleSelect: () => undefined,
      onViewProduct: () => undefined,
      onEditProduct: () => undefined,
      onApproveProduct: () => undefined,
      onRejectProduct: () => undefined,
    }),
  );

  // Synced item has sync badge
  assert.match(cardHtml, /Synced Leather Jacket/);
  assert.match(cardHtml, /Đã đẩy \(capozen\)/);

  // Reverted item has reverted badge and history
  assert.match(cardHtml, /Reverted Vintage Rug/);
  assert.match(cardHtml, /Shopify: Đã hoàn tác \(capozen\)/);
  assert.match(cardHtml, /Trạng thái hiện tại: Đã hoàn tác về dữ liệu gốc/);

  // Fresh pending item has 'Chưa đẩy Store'
  assert.match(cardHtml, /Fresh Unreviewed Lamp/);
  assert.match(cardHtml, /Chưa đẩy Store/);
});

test("Scenario 3: Self-healing against corrupted/stale state in browser storage", () => {
  const sample = getInitialSampleViewModels()[0]!;

  // Corrupted state: product has lastRevertedAt + pending, but shopifySyncStatus was somehow left on 'synced'
  const corruptedItem: SeoProductUiViewModel = {
    ...sample,
    id: "corrupted-1",
    storeId: "capozen",
    reviewDecision: "pending",
    shopifySyncStatus: "synced",
    lastRevertedAt: Date.now(),
    shopifySyncedAt: 1774000000000,
    originalBackup: {
      productTitle: "Corrupted Item Backup",
      productDescription: "Desc",
    },
  };

  // 1. Stats calculation must defensively exclude it from synced count:
  const stats = calculateStats([corruptedItem]);
  assert.equal(stats.synced, 0, "Defensive stat calculation must report 0 for synced");

  // 2. Component rendering must defensively show 'Shopify: Đã hoàn tác', not 'Đã đẩy':
  const html = renderToStaticMarkup(
    createElement(ProductCardList, {
      products: [corruptedItem],
      selectedIds: new Set<string>(),
      currentStoreId: "capozen",
      onToggleSelect: () => undefined,
      onViewProduct: () => undefined,
      onEditProduct: () => undefined,
      onApproveProduct: () => undefined,
      onRejectProduct: () => undefined,
    }),
  );
  assert.doesNotMatch(html, /Đã đẩy \(capozen\)/, "Must NOT display 'Đã đẩy (capozen)' even if shopifySyncStatus is stuck on 'synced'");
  assert.match(html, /Shopify: Đã hoàn tác \(capozen\)/, "Must display 'Shopify: Đã hoàn tác (capozen)'");

  // 3. Storage rehydration cleaner must heal the corrupted product to 'idle':
  const healed = rehydrateSessionStorageProducts([corruptedItem])[0]!;
  assert.equal(healed.shopifySyncStatus, "idle", "Healed status must be idle");
  assert.equal(healed.shopifySyncedAt, undefined, "Healed shopifySyncedAt must be undefined");
  assert.equal(healed.previousSyncedAt, 1774000000000, "Healed previousSyncedAt must be preserved");
});

test("Scenario 4: Re-approval transition - Approver re-approves reverted product", () => {
  const sample = getInitialSampleViewModels()[0]!;

  const revertedItem: SeoProductUiViewModel = {
    ...sample,
    storeId: "capozen",
    reviewDecision: "pending",
    shopifySyncStatus: "idle",
    lastRevertedAt: Date.now() - 3600000,
    previousSyncedAt: Date.now() - 7200000,
    originalBackup: {
      productTitle: "Original Rug",
      productDescription: "Desc",
    },
  };

  // User approves the product:
  const reApprovedItem: SeoProductUiViewModel = {
    ...revertedItem,
    reviewDecision: "approved",
  };

  const stats = calculateStats([reApprovedItem]);
  assert.equal(stats.synced, 0, "Synced count remains 0 because it hasn't been pushed to Shopify yet");
  assert.equal(stats.approved, 1, "Approved count is 1");
  assert.equal(stats.approvedUnsynced, 1, "Counted as approved but unsynced");

  const html = renderToStaticMarkup(
    createElement(ProductCardList, {
      products: [reApprovedItem],
      selectedIds: new Set<string>(),
      currentStoreId: "capozen",
      onToggleSelect: () => undefined,
      onViewProduct: () => undefined,
      onEditProduct: () => undefined,
      onApproveProduct: () => undefined,
      onRejectProduct: () => undefined,
      onRetrySync: () => undefined,
    }),
  );

  assert.doesNotMatch(html, /Đã đẩy \(capozen\)/, "Must NOT display 'Đã đẩy (capozen)'");
  assert.doesNotMatch(html, /Shopify: Đã hoàn tác/, "Must NOT display 'Shopify: Đã hoàn tác' once re-approved");
  assert.match(html, /Chưa đẩy Store/, "Badge shows 'Chưa đẩy Store'");
  assert.match(html, /Sync Shopify/, "Action button offers 'Sync Shopify'");
});

test("Scenario 5: Re-syncing transition - Product pushed back to Shopify after re-approval", () => {
  const sample = getInitialSampleViewModels()[0]!;
  const newSyncTime = Date.now();

  const newlySyncedItem: SeoProductUiViewModel = {
    ...sample,
    storeId: "capozen",
    reviewDecision: "approved",
    shopifySyncStatus: "synced",
    shopifySyncedAt: newSyncTime,
    lastSyncedAt: newSyncTime,
    lastRevertedAt: undefined, // Cleared on successful sync
    previousSyncedAt: undefined, // Cleared on successful sync
  };

  const stats = calculateStats([newlySyncedItem]);
  assert.equal(stats.synced, 1, "Now synced count is 1");
  assert.equal(stats.approved, 1);
  assert.equal(stats.approvedUnsynced, 0);

  const html = renderToStaticMarkup(
    createElement(ProductCardList, {
      products: [newlySyncedItem],
      selectedIds: new Set<string>(),
      currentStoreId: "capozen",
      onToggleSelect: () => undefined,
      onViewProduct: () => undefined,
      onEditProduct: () => undefined,
      onApproveProduct: () => undefined,
      onRejectProduct: () => undefined,
    }),
  );

  assert.match(html, /Đã đẩy \(capozen\)/, "Displays 'Đã đẩy (capozen)'");
  assert.doesNotMatch(html, /Đã hoàn tác/, "Does not display 'Đã hoàn tác'");
});

test("Scenario 6: Real-time crawler polling does not overwrite local rollback state", () => {
  const sample = getInitialSampleViewModels()[0]!;

  const localRevertedItem: SeoProductUiViewModel = {
    ...sample,
    id: "item-crawler-01",
    storeId: "capozen",
    productTitle: { value: "Original Restored Title", source: "real" },
    reviewDecision: "pending",
    shopifySyncStatus: "idle",
    lastRevertedAt: 1774000500000,
    previousSyncedAt: 1774000000000,
    originalBackup: {
      productTitle: "Original Restored Title",
      productDescription: "Desc",
    },
  };

  // Fresh incoming polling packet from crawler server has outdated 'approved' or 'synced' info
  const incomingCrawlerPacket: SeoProductUiViewModel = {
    ...sample,
    id: "item-crawler-01",
    storeId: "capozen",
    productTitle: { value: "Outdated Server Title", source: "real" },
    reviewDecision: "approved",
    shopifySyncStatus: "synced",
    shopifySyncedAt: 1774000000000,
  };

  const merged = mergeSubscriberCrawlerProducts([localRevertedItem], [incomingCrawlerPacket]);
  const result = merged[0]!;

  assert.equal(result.productTitle.value, "Original Restored Title", "Must preserve local restored title");
  assert.equal(result.reviewDecision, "pending", "Must preserve pending status");
  assert.equal(result.shopifySyncStatus, "idle", "Must preserve idle sync status");
  assert.equal(result.lastRevertedAt, 1774000500000, "Must preserve lastRevertedAt");
  assert.equal(result.previousSyncedAt, 1774000000000, "Must preserve previousSyncedAt");
});
