import type {
  AutoSeoEligibilityItem,
  ShopifyProductForAutoSeoUi,
} from "../types";

export type AutoSeoBatchSize = 10 | 20 | 50 | 100;
export type AutoSeoEligibilityFilter = "needs_seo" | "active" | "current" | "all";

export interface SelectedSeoRevision {
  readonly productId: string;
  readonly jobId: string;
}

const ELIGIBLE_PRIORITIES: Readonly<Record<string, number>> = {
  never_processed: 0,
  changed: 1,
  retry: 1,
};

export function selectNextAutoSeoBatch(
  products: readonly ShopifyProductForAutoSeoUi[],
  eligibilityItems: readonly AutoSeoEligibilityItem[],
  batchSize: AutoSeoBatchSize,
): readonly string[] {
  const eligibilityByProductId = new Map(
    eligibilityItems.map(item => [item.productId, item] as const),
  );
  const uniqueProducts = new Map<string, ShopifyProductForAutoSeoUi>();
  for (const product of products) {
    if (!uniqueProducts.has(product.id)) {
      uniqueProducts.set(product.id, product);
    }
  }

  return [...uniqueProducts.values()]
    .filter(product => ELIGIBLE_PRIORITIES[eligibilityByProductId.get(product.id)?.state ?? ""] !== undefined)
    .sort((left, right) => {
      const leftState = eligibilityByProductId.get(left.id)?.state ?? "";
      const rightState = eligibilityByProductId.get(right.id)?.state ?? "";
      const priorityDifference = ELIGIBLE_PRIORITIES[leftState]! - ELIGIBLE_PRIORITIES[rightState]!;
      if (priorityDifference !== 0) return priorityDifference;

      const leftTimestamp = parseTimestamp(left.updatedAt);
      const rightTimestamp = parseTimestamp(right.updatedAt);
      if (leftTimestamp !== rightTimestamp) return rightTimestamp - leftTimestamp;
      return left.id.localeCompare(right.id);
    })
    .slice(0, batchSize)
    .map(product => product.id);
}

export function selectSeoRevisionJobs(
  selectedProductIds: readonly string[],
  eligibilityItems: readonly AutoSeoEligibilityItem[],
): readonly SelectedSeoRevision[] {
  const selectedIds = new Set(selectedProductIds);
  const seenJobIds = new Set<string>();
  return eligibilityItems.flatMap((item): readonly SelectedSeoRevision[] => {
    if (
      !selectedIds.has(item.productId) ||
      item.state !== "current" ||
      item.reason !== "SHOPIFY_SYNCED" ||
      !item.jobId ||
      seenJobIds.has(item.jobId)
    ) {
      return [];
    }
    seenJobIds.add(item.jobId);
    return [{ productId: item.productId, jobId: item.jobId }];
  });
}

function parseTimestamp(value?: string): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}
