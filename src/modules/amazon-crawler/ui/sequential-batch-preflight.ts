import type { AmazonCrawlerInput, AmazonCrawlerBatchSkippedInput, ShopifyAsinFilter } from "../types";
import { normalizeAmazonAsins } from "./amazon-asin-preflight";

export async function prepareSequentialBatch(
  sources: readonly string[], storeId: string, filter: ShopifyAsinFilter,
): Promise<Pick<AmazonCrawlerInput, "urls" | "sequentialBatch" | "existingShopifyAsins" | "batchSkippedInputs">> {
  const asins = normalizeAmazonAsins(sources);
  if (asins.length === 0 || asins.length > 200) throw new Error("Mỗi lô cần từ 1 đến 200 ASIN hợp lệ.");
  const checked = await filter({ storeId, asins });
  const existing = new Set(checked.matches.map(match => match.asin));
  const missing = new Set(checked.missingAsins);
  const activity = new Map((checked.activity ?? []).map(entry => [entry.asin, entry]));
  if (checked.storeId !== storeId || asins.some(asin => existing.has(asin) === missing.has(asin)
    || (missing.has(asin) && !activity.has(asin)))) {
    throw new Error("Chưa xác minh đầy đủ Shopify và SEO Queue. Chưa tạo lô cào; vui lòng thử lại.");
  }
  const batchSkippedInputs: AmazonCrawlerBatchSkippedInput[] = [];
  for (const asin of asins) {
    if (existing.has(asin)) batchSkippedInputs.push({ asin, reason: "existing_shopify" });
    else {
      const status = activity.get(asin)?.status;
      if (status === "attention") batchSkippedInputs.push({ asin, reason: "attention" });
      else if (status === "processing" || status === "crawling") batchSkippedInputs.push({ asin, reason: "existing_pipeline" });
    }
  }
  return { urls: asins, sequentialBatch: true, existingShopifyAsins: [...existing], batchSkippedInputs };
}
