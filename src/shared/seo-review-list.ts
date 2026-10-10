/** Review lifecycle shared by the UI and independent catalog data sources. */
export type SeoReviewStage = "pending" | "ready" | "syncing" | "failed" | "history";
export type SeoReviewWorkspace = "work" | "history" | "all" | "synced";
export type SeoReviewCounts = Readonly<Record<SeoReviewStage, number> & { synced?: number }>;
export interface SeoReviewActions {
  readonly canEdit: boolean;
  readonly canDecide: boolean;
  readonly canSync: boolean;
  readonly canArchive: boolean;
  readonly canRetry: boolean;
  readonly canReconcile: boolean;
  readonly canRevise: boolean;
}
interface ReviewLifecycle {
  readonly decision: "pending" | "approved" | "rejected";
  readonly syncStatus: "idle" | "queued" | "syncing" | "synced" | "failed";
  readonly archivedAt?: number;
  readonly hasPublish?: boolean;
  readonly isUnresolved?: boolean;
  readonly isSuperseded?: boolean;
}
export function getSeoReviewStage(review: ReviewLifecycle): SeoReviewStage {
  if (review.archivedAt || review.isSuperseded || review.syncStatus === "synced" || review.decision === "rejected") return "history";
  if (review.syncStatus === "failed") return "failed";
  if (review.syncStatus === "queued" || review.syncStatus === "syncing" || review.isUnresolved) return "syncing";
  return review.decision === "approved" ? "ready" : "pending";
}
export function getSeoReviewActions(review: ReviewLifecycle): SeoReviewActions {
  const isBusy = review.syncStatus === "queued" || review.syncStatus === "syncing" || Boolean(review.isUnresolved);
  const isArchived = Boolean(review.archivedAt || review.isSuperseded);
  const canChange = !isBusy && !isArchived && !review.hasPublish && review.syncStatus !== "synced";
  return {
    canEdit: canChange, canDecide: canChange,
    canSync: canChange && review.decision === "approved" && review.syncStatus === "idle",
    canArchive: !isBusy && !review.archivedAt,
    canRetry: canChange && review.decision === "approved" && review.syncStatus === "failed",
    canReconcile: !isArchived && review.syncStatus === "failed" && Boolean(review.isUnresolved),
    canRevise: !isBusy && !isArchived && Boolean(review.hasPublish),
  };
}
export function emptySeoReviewCounts(): Record<SeoReviewStage, number> {
  return { pending: 0, ready: 0, syncing: 0, failed: 0, history: 0 };
}

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
  readonly archivedAt?: number;
  readonly stage?: SeoReviewStage;
  readonly actions?: SeoReviewActions;
}

export interface SeoReviewListPage {
  readonly items: readonly SeoReviewListItem[];
  readonly total: number;
  readonly nextOffset: number | null;
  readonly counts?: SeoReviewCounts;
}

export interface SeoReviewListQuery {
  readonly storeId: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly search?: string;
  readonly decision?: "pending" | "approved" | "rejected" | "sync_failed";
  readonly signal?: AbortSignal;
  readonly workspace?: SeoReviewWorkspace;
  readonly stage?: SeoReviewStage;
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
    let actions: SeoReviewActions | undefined;
    if (item.actions !== undefined) {
      const keys = ["canEdit", "canDecide", "canSync", "canArchive", "canRetry", "canReconcile", "canRevise"] as const;
      if (!isRecord(item.actions) || keys.some(key => typeof (item.actions as Record<string, unknown>)[key] !== "boolean")) throw new Error("Invalid review actions");
      const fields = item.actions;
      actions = { canEdit: fields.canEdit === true, canDecide: fields.canDecide === true, canSync: fields.canSync === true,
        canArchive: fields.canArchive === true, canRetry: fields.canRetry === true, canReconcile: fields.canReconcile === true, canRevise: fields.canRevise === true };
    }
    if (item.stage !== undefined && !["pending", "ready", "syncing", "failed", "history"].includes(String(item.stage))) throw new Error("Invalid review stage");
    if (item.archivedAt !== undefined && item.archivedAt !== null && (typeof item.archivedAt !== "number" || !Number.isFinite(item.archivedAt) || item.archivedAt < 0)) throw new Error("Invalid review archive timestamp");
    return { id: item.id, recordId: item.recordId, storeId, source: item.source as SeoReviewListItem["source"], title: item.title,
      handle: item.handle, thumbnailUrl: item.thumbnailUrl, updatedAt: item.updatedAt, decision: item.decision as SeoReviewListItem["decision"], syncStatus: item.syncStatus as SeoReviewListItem["syncStatus"],
      productId: typeof item.productId === "string" ? item.productId : undefined, asin: typeof item.asin === "string" ? item.asin : undefined,
      thumbnailToken: typeof item.thumbnailToken === "string" ? item.thumbnailToken : undefined, syncError: typeof item.syncError === "string" ? item.syncError : undefined,
      actions, stage: item.stage as SeoReviewStage | undefined, archivedAt: typeof item.archivedAt === "number" ? item.archivedAt : undefined };
  });
  let counts: SeoReviewCounts | undefined;
  if (value.counts !== undefined) {
    if (!isRecord(value.counts)) throw new Error("Invalid review counts");
    const fields = value.counts;
    const parsed = emptySeoReviewCounts();
    for (const key of Object.keys(parsed) as SeoReviewStage[]) {
      if (!Number.isSafeInteger(fields[key]) || Number(fields[key]) < 0) throw new Error("Invalid review counts");
      parsed[key] = Number(fields[key]);
    }
    if (fields.synced !== undefined && (!Number.isSafeInteger(fields.synced) || Number(fields.synced) < 0)) throw new Error("Invalid synced review count");
    counts = { ...parsed, ...(fields.synced !== undefined ? { synced: Number(fields.synced) } : {}) };
  }
  return { items, total: Number(value.total), counts, nextOffset: value.nextOffset === null ? null : Number(value.nextOffset) };
}
