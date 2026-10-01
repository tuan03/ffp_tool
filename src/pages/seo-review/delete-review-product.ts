import type { SeoProductUiViewModel } from "./types";

interface ReviewDeleteDependencies {
  readonly crawler?: {
    delete(itemId: string): Promise<{ readonly deleted: boolean }>;
  };
  readonly gpt?: {
    cancelReview(storeId: string, jobId: string): Promise<unknown>;
  };
  readonly fetcher?: typeof fetch;
}

async function readDeleteError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object" && "error" in payload) {
      const error = payload.error;
      if (error && typeof error === "object" && "message" in error) return String(error.message);
    }
  } catch {
    // Fall back to the status below when the server response is not JSON.
  }
  return `SEO Review API returned HTTP ${response.status}`;
}

export async function deleteSeoReviewProduct(
  product: SeoProductUiViewModel,
  dependencies: ReviewDeleteDependencies = {},
): Promise<void> {
  if (product.coordinatorReview) {
    if (!dependencies.crawler) throw new Error("Distributed Crawler is not connected");
    await dependencies.crawler.delete(product.coordinatorReview.itemId);
    return;
  }

  if (product.gptJobId) {
    if (!dependencies.gpt) throw new Error("GPT SEO is not connected");
    const targetStoreId = product.storeId?.trim();
    if (!targetStoreId) throw new Error("GPT SEO review is missing its store");
    await dependencies.gpt.cancelReview(targetStoreId, product.gptJobId);
    return;
  }

  if (product.sourceOrigin === "auto_seo") {
    const defaultItemId = product.storeId && product.productId
      ? `${product.storeId}:${product.productId}`
      : product.id;
    const itemId = product.productId && product.id === product.productId ? defaultItemId : product.id;
    const response = await (dependencies.fetcher ?? fetch)(
      `/api/seo-review/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error(await readDeleteError(response));
  }
}
