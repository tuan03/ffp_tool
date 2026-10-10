/** Small read-only catalog contract shared by the Review UI and its data sources. */
export interface SeoReviewListItem {
  readonly id: string;
  readonly recordId: string;
  readonly storeId: string;
  readonly source: "gpt" | "crawler" | "auto_seo";
  readonly productId?: string;
  readonly title: string;
  readonly handle: string;
  readonly asin?: string;
  readonly thumbnailUrl: string;
  readonly thumbnailToken?: string;
  readonly decision: "pending" | "approved" | "rejected";
  readonly syncStatus: "idle" | "queued" | "syncing" | "synced" | "failed";
  readonly syncError?: string;
  readonly updatedAt: number;
}

export interface SeoReviewListPage {
  readonly items: readonly SeoReviewListItem[];
  readonly total: number;
  readonly nextOffset: number | null;
}

export interface SeoReviewListQuery {
  readonly storeId: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly search?: string;
  readonly decision?: "pending" | "approved" | "rejected" | "sync_failed";
  readonly signal?: AbortSignal;
}

export function readSeoReviewListPage(value: unknown, storeId: string): SeoReviewListPage {
  const isRecord = (candidate: unknown): candidate is Record<string, unknown> => typeof candidate === "object" && candidate !== null;
  if (!isRecord(value) || !Array.isArray(value.items) || !Number.isSafeInteger(value.total) || Number(value.total) < 0 || value.items.length > 50 ||
      !(value.nextOffset === null || Number.isSafeInteger(value.nextOffset) && Number(value.nextOffset) >= 0)) throw new Error("Invalid review catalog");
  const items = value.items.map((item: unknown): SeoReviewListItem => {
    if (!isRecord(item) || item.storeId !== storeId || typeof item.id !== "string" || typeof item.recordId !== "string" ||
        typeof item.title !== "string" || typeof item.handle !== "string" || typeof item.thumbnailUrl !== "string" ||
        typeof item.updatedAt !== "number" || !Number.isFinite(item.updatedAt) ||
        !["gpt", "crawler", "auto_seo"].includes(String(item.source)) || !["pending", "approved", "rejected"].includes(String(item.decision)) ||
        !["idle", "queued", "syncing", "synced", "failed"].includes(String(item.syncStatus))) throw new Error("Invalid review catalog row");
    return { id: item.id, recordId: item.recordId, storeId, source: item.source as SeoReviewListItem["source"], title: item.title,
      handle: item.handle, thumbnailUrl: item.thumbnailUrl, updatedAt: item.updatedAt, decision: item.decision as SeoReviewListItem["decision"], syncStatus: item.syncStatus as SeoReviewListItem["syncStatus"],
      productId: typeof item.productId === "string" ? item.productId : undefined, asin: typeof item.asin === "string" ? item.asin : undefined,
      thumbnailToken: typeof item.thumbnailToken === "string" ? item.thumbnailToken : undefined, syncError: typeof item.syncError === "string" ? item.syncError : undefined };
  });
  return { items, total: Number(value.total), nextOffset: value.nextOffset === null ? null : Number(value.nextOffset) };
}
