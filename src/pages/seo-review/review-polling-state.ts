import type { SeoProductUiViewModel } from "./types";

export function mergeCrawlerReviewPollingState(
  existing: SeoProductUiViewModel | undefined,
  fresh: SeoProductUiViewModel,
): SeoProductUiViewModel {
  if (!existing) return fresh;

  // An idle response can be an older poll that raced with the sync request.
  // Durable queued, syncing, synced, and failed states from the server always win.
  if (existing.isSyncing && fresh.shopifySyncStatus === "idle") {
    return {
      ...fresh,
      isSyncing: true,
      shopifySyncStatus: "syncing",
    };
  }

  if (existing.isReverting) {
    return {
      ...fresh,
      isReverting: true,
    };
  }

  if (existing.shopifySyncStatus === "failed" && fresh.shopifySyncStatus !== "synced") {
    return {
      ...fresh,
      shopifySyncStatus: "failed",
      shopifySyncError: existing.shopifySyncError || fresh.shopifySyncError,
      syncError: existing.syncError || fresh.syncError,
      isSyncing: false,
    };
  }

  return fresh;
}
