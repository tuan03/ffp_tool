import { emptySeoReviewCounts } from "../../shared/seo-review-list";
import type { SeoReviewCounts, SeoReviewListItem, SeoReviewListPage } from "../../shared/seo-review-list";
import type { SeoProductUiViewModel } from "./types";

export type ReviewOffsets = Record<SeoReviewListItem["source"], number>;
export interface ReviewCatalog {
  readonly items: readonly SeoReviewListItem[];
  readonly total: number;
  readonly nextOffsets: ReviewOffsets;
  readonly hasNextPage: boolean;
  readonly counts: SeoReviewCounts;
}

export function mergeReviewCatalogPages(pages: Partial<Record<SeoReviewListItem["source"], SeoReviewListPage>>, offsets: ReviewOffsets): ReviewCatalog {
  const items = Object.values(pages).flatMap(page => [...page.items])
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, 50);
  const nextOffsets = { ...offsets };
  for (const item of items) nextOffsets[item.source] += 1;
  const total = Object.values(pages).reduce((count, page) => count + page.total, 0);
  const counts = emptySeoReviewCounts();
  for (const page of Object.values(pages)) {
    if (page.counts) for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] += page.counts[key];
  }
  const hasNextPage = Object.entries(pages).some(([source, page]) => nextOffsets[source as SeoReviewListItem["source"]] < page.total);
  return { items, total, counts, nextOffsets, hasNextPage };
}

export function adaptReviewListItem(item: SeoReviewListItem): SeoProductUiViewModel {
  const field = (value: string) => ({ value, source: "real" as const });
  return {
    reviewListItem: item, id: item.id, storeId: item.storeId, productId: item.productId, asin: item.asin,
    reviewActions: item.actions, reviewArchivedAt: item.archivedAt, reviewLifecycleStage: item.stage,
    gptJobId: item.source === "gpt" ? item.recordId : undefined,
    backendPublishRequired: item.source === "gpt",
    sourceOrigin: item.source === "crawler" ? "distributed_crawler" : "auto_seo",
    productTitle: field(item.title), handle: field(item.handle), productDescription: field(""),
    seoTitle: field(""), seoDescription: field(""), seoStatus: { value: "completed", source: "real" },
    images: item.thumbnailUrl ? [{ id: "thumbnail", previewUrl: field(item.thumbnailUrl), alt: field(item.title), webpUrl: field(""), webpFilename: field("") }] : [],
    reviewDecision: item.decision, shopifySyncStatus: item.syncStatus, shopifySyncError: item.syncError,
    updatedAt: item.updatedAt,
  };
}
