import type { SeoProductUiViewModel } from "./types";
import { reviewActions } from "./review-actions";

interface ArchiveDependencies {
  readonly crawler?: { archive?(itemId: string, storeId: string): Promise<{ readonly archived: boolean }> };
  readonly gpt: { archiveReview(storeId: string, jobId: string): Promise<{ readonly archived: boolean }> };
  readonly fetcher?: typeof fetch;
}
export async function archiveSeoReviewProduct(product: SeoProductUiViewModel, dependencies: ArchiveDependencies): Promise<void> {
  if (!reviewActions(product).canArchive) throw new Error("Bản Review đang sync, cần đối chiếu hoặc đã lưu trữ.");
  const storeId = product.storeId;
  if (!storeId) throw new Error("Review thiếu store đích.");
  const catalog = product.reviewListItem;
  if (catalog?.source === "crawler" || product.coordinatorReview) {
    if (!dependencies.crawler?.archive) throw new Error("Crawler chưa hỗ trợ lưu trữ Review.");
    const confirmation = await dependencies.crawler.archive(catalog?.recordId ?? product.coordinatorReview?.itemId ?? product.id, storeId);
    if (!confirmation.archived) throw new Error("Backend chưa xác nhận lưu trữ.");
  } else if (product.gptJobId) {
    const confirmation = await dependencies.gpt.archiveReview(storeId, product.gptJobId);
    if (!confirmation.archived) throw new Error("Backend chưa xác nhận lưu trữ.");
  } else if (product.sourceOrigin === "auto_seo") {
    const recordId = catalog?.recordId ?? `${storeId}:${product.productId}`;
    const response = await (dependencies.fetcher ?? fetch)(`/api/seo-review/items/${encodeURIComponent(recordId)}/archive?source=auto_seo`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId }),
    });
    if (!response.ok) throw new Error(`Không thể lưu trữ Review (${response.status}).`);
    const confirmation: unknown = await response.json();
    if (!confirmation || typeof confirmation !== "object" || !("archived" in confirmation) || confirmation.archived !== true) throw new Error("Backend chưa xác nhận lưu trữ.");
  } else throw new Error("Nguồn sản phẩm này chưa hỗ trợ lưu trữ bền vững; dữ liệu được giữ nguyên.");
}
