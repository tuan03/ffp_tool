import assert from "node:assert/strict";
import { test } from "node:test";

import { deleteSeoReviewProduct } from "../delete-review-product";
import type { SeoProductUiViewModel } from "../types";

function product(overrides: Partial<SeoProductUiViewModel>): SeoProductUiViewModel {
  return {
    id: "review-1",
    productTitle: { value: "Product", source: "real" },
    productDescription: { value: "Description", source: "real" },
    seoTitle: { value: "SEO title", source: "real" },
    seoDescription: { value: "SEO description", source: "real" },
    handle: { value: "product", source: "real" },
    images: [],
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "pending",
    updatedAt: 1,
    ...overrides,
  };
}

test("deleteSeoReviewProduct dispatches crawler, GPT, Auto SEO, and Pinterest reviews", async () => {
  const calls: string[] = [];
  const dependencies = {
    crawler: { delete: async (itemId: string) => { calls.push(`crawler:${itemId}`); return { deleted: true as const }; } },
    gpt: { cancelReview: async (storeId: string, jobId: string) => { calls.push(`gpt:${storeId}:${jobId}`); return { cancelled: true }; } },
    fetcher: async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`fetch:${String(url)}:${init?.method}`);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  };

  await deleteSeoReviewProduct(product({ coordinatorReview: { itemId: "crawler-1", jobId: "job", version: 1, target: { collectionIds: [], priceAddition: 0, discountPercent: 0 } } }), dependencies);
  await deleteSeoReviewProduct(product({ gptJobId: "gpt-1", storeId: "capozen", sourceOrigin: "auto_seo" }), dependencies);
  await deleteSeoReviewProduct(product({ id: "product-1", productId: "product-1", storeId: "capozen", sourceOrigin: "auto_seo" }), dependencies);
  await deleteSeoReviewProduct(product({ id: "custom-review-key", productId: "product-2", storeId: "capozen", sourceOrigin: "auto_seo" }), dependencies);
  await deleteSeoReviewProduct(product({ sourceOrigin: "pinterest_pod" }), dependencies);

  assert.deepEqual(calls, [
    "crawler:crawler-1",
    "gpt:capozen:gpt-1",
    "fetch:/api/seo-review/items/capozen%3Aproduct-1?source=auto_seo:DELETE",
    "fetch:/api/seo-review/items/custom-review-key?source=auto_seo:DELETE",
  ]);
});

test("deleteSeoReviewProduct keeps failed server deletions visible to its caller", async () => {
  await assert.rejects(
    deleteSeoReviewProduct(product({ sourceOrigin: "auto_seo" }), {
      fetcher: async () => new Response(JSON.stringify({ error: { message: "Database unavailable" } }), { status: 503 }),
    }),
    /Database unavailable/,
  );
});
