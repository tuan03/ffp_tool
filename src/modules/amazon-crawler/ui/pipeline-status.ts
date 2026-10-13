import type {
  AmazonCrawlerProduct,
  AmazonCrawlerSeoQueueHandoffSummary,
  ProductPipelineMetadata,
} from "../types";

export type CrawlerSeoHandoffState = "pending" | "handing_over" | "handed_over" | "not_handed_over";

const DOWNSTREAM_STATUSES = new Set<ProductPipelineMetadata["status"]>([
  "image_processing",
  "waiting_review",
  "sync_queued",
  "syncing",
  "shopify_writing",
  "stopping_after_write",
  "completed",
  "rejected",
  "reconciliation_required",
]);

function hasDurableSeoQueueHandoff(pipeline: ProductPipelineMetadata): boolean {
  return pipeline.seo.engine === "codex_mcp"
    || pipeline.seo.engine === "custom_gpt"
    || DOWNSTREAM_STATUSES.has(pipeline.status);
}

export function crawlerSeoHandoffState(
  pipeline: ProductPipelineMetadata | undefined,
): CrawlerSeoHandoffState {
  if (!pipeline) return "pending";
  if (hasDurableSeoQueueHandoff(pipeline)) return "handed_over";
  if (pipeline.status === "failed" || pipeline.status === "cancelled") return "not_handed_over";
  if (pipeline.status === "seo" || pipeline.status === "retry_wait") return "handing_over";
  return "pending";
}

export function crawlerSeoHandoffLabel(pipeline: ProductPipelineMetadata | undefined): string {
  const labels: Readonly<Record<CrawlerSeoHandoffState, string>> = {
    pending: "Đang chờ Pipeline bàn giao",
    handing_over: "Đang bàn giao SEO Queue",
    handed_over: "Đã bàn giao SEO Queue",
    not_handed_over: "Chưa bàn giao SEO Queue",
  };
  return labels[crawlerSeoHandoffState(pipeline)];
}

export function summarizeCrawlerSeoHandoffs(products: readonly AmazonCrawlerProduct[]): {
  readonly handedOver: number;
  readonly pending: number;
  readonly notHandedOver: number;
} {
  return products.reduce((summary, product) => {
    const state = crawlerSeoHandoffState(product.pipeline);
    if (state === "handed_over") summary.handedOver += 1;
    else if (state === "not_handed_over") summary.notHandedOver += 1;
    else summary.pending += 1;
    return summary;
  }, { handedOver: 0, pending: 0, notHandedOver: 0 });
}

export function resolveCrawlerSeoHandoffSummary(
  products: readonly AmazonCrawlerProduct[],
  durableSummary: AmazonCrawlerSeoQueueHandoffSummary | undefined,
): AmazonCrawlerSeoQueueHandoffSummary {
  if (durableSummary && (durableSummary.totalProducts > 0 || (durableSummary.skippedExistingShopify ?? 0) > 0
    || (durableSummary.skippedExistingPipeline ?? 0) > 0)) return durableSummary;
  const localSummary = summarizeCrawlerSeoHandoffs(products);
  return { totalProducts: products.length, ...localSummary };
}

export function resolveInlineCrawlerHandoff(input: {
  readonly completedJobId: string | null;
  readonly dismissedJobId: string | null;
  readonly isBusy: boolean;
  readonly storeId: string;
  readonly resultStoreId: string;
  readonly summary: AmazonCrawlerSeoQueueHandoffSummary;
}): { readonly label: string; readonly tone: "success" | "warning" } | null {
  if (!input.completedJobId || input.isBusy || input.completedJobId === input.dismissedJobId
      || input.storeId.toLowerCase() !== input.resultStoreId.toLowerCase()) return null;
  const summary = input.summary;
  const hasSkips = (summary.skippedExistingShopify ?? 0) > 0 || (summary.skippedExistingPipeline ?? 0) > 0;
  const details = [summary.totalProducts > 0
    ? `Đã bàn giao ${summary.handedOver}/${summary.totalProducts} sản phẩm sang SEO Queue`
    : hasSkips ? "Không có sản phẩm mới" : "Chưa có sản phẩm bàn giao SEO Queue"];
  if (summary.pending > 0) details.push(`${summary.pending} chờ bàn giao`);
  if (summary.notHandedOver > 0) details.push(`${summary.notHandedOver} chưa bàn giao`);
  if ((summary.skippedExistingShopify ?? 0) > 0) details.push(`${summary.skippedExistingShopify} đã có Shopify`);
  if ((summary.skippedExistingPipeline ?? 0) > 0) details.push(`${summary.skippedExistingPipeline} giữ dữ liệu cũ`);
  return { label: details.join(" · "), tone: summary.pending > 0 || summary.notHandedOver > 0
    || (summary.totalProducts === 0 && !hasSkips) ? "warning" : "success" };
}
