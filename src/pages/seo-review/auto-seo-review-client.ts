import { adaptSeoOutputToViewModel } from "./seo-content-ui-adapter";
import type { SeoProductBackup, SeoProductEditInput, SeoProductUiViewModel, ShopifySyncStatus } from "./types";

interface DurableAutoSeoReview {
  readonly itemId: string;
  readonly storeId: string;
  readonly productId: string;
  readonly reviewStatus: "pending" | "approved" | "rejected";
  readonly generatedPayload: string;
  readonly shopifyUpdatedAt: string | null;
  readonly notes: string | null;
  readonly updatedAt: string;
  readonly backupId: string;
  readonly sourceOrigin: "auto_seo";
  readonly originalBackup: SeoProductBackup;
  readonly reviewArchivedAt?: number;
}

function mapReview(review: DurableAutoSeoReview): SeoProductUiViewModel {
  if (review.sourceOrigin !== "auto_seo" || !review.backupId || !review.originalBackup?.productTitle) {
    throw new Error("Auto SEO review backup is unavailable");
  }
  const generated: unknown = JSON.parse(review.generatedPayload);
  if (!generated || typeof generated !== "object") throw new Error("Invalid Auto SEO review payload");
  const output = generated as Record<string, unknown>;
  const images = Array.isArray(output.images) ? output.images.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const image = value as Record<string, unknown>;
    const webp = image.webp && typeof image.webp === "object" ? image.webp as Record<string, unknown> : {};
    return [{ sourceUrl: typeof image.sourceUrl === "string" ? image.sourceUrl : "", alt: typeof image.alt === "string" ? image.alt : "", webp: { filename: typeof webp.filename === "string" ? webp.filename : "", url: typeof webp.url === "string" ? webp.url : undefined } }];
  }) : [];
  const mapped = adaptSeoOutputToViewModel({
    productTitle: typeof output.productTitle === "string" ? output.productTitle : typeof output.title === "string" ? output.title : undefined,
    productDescription: typeof output.productDescription === "string" ? output.productDescription : typeof output.description === "string" ? output.description : undefined,
    productSeoTitle: typeof output.productSeoTitle === "string" ? output.productSeoTitle : typeof output.seoTitle === "string" ? output.seoTitle : undefined,
    productSeoDescription: typeof output.productSeoDescription === "string" ? output.productSeoDescription : typeof output.seoDescription === "string" ? output.seoDescription : undefined,
    productHandle: typeof output.productHandle === "string" ? output.productHandle : typeof output.handle === "string" ? output.handle : undefined,
    images,
  }, {
    id: review.productId,
    productId: review.productId,
    storeId: review.storeId,
    sourceOrigin: "auto_seo",
    originalBackup: review.originalBackup,
    initialDecision: review.reviewStatus,
    defaultStatus: "completed",
    isStatusReal: true,
  });
  const imageAlts = Array.isArray(output.imageAlts) ? output.imageAlts : [];
  return {
    ...mapped,
    shopifySyncStatus: ["idle", "queued", "syncing", "synced", "failed"].includes(String(output.shopifySyncStatus)) ? output.shopifySyncStatus as ShopifySyncStatus : "idle",
    shopifyAdminUrl: typeof output.shopifyAdminUrl === "string" ? output.shopifyAdminUrl : undefined,
    reviewArchivedAt: review.reviewArchivedAt,
    images: mapped.images.map((image, index) => typeof imageAlts[index] === "string" ? { ...image, alt: { value: imageAlts[index] as string, source: "real" as const } } : image),
    sourceShopifyUpdatedAt: review.shopifyUpdatedAt ?? undefined,
    rejectionReason: review.reviewStatus === "rejected" ? review.notes ?? undefined : undefined,
    updatedAt: Number.isFinite(Date.parse(review.updatedAt)) ? Date.parse(review.updatedAt) : Date.now(),
  };
}

export async function saveAutoSeoReviewSyncOutcome(product: SeoProductUiViewModel, outcome: { readonly shopifySyncStatus: "synced" | "failed"; readonly shopifyAdminUrl?: string }): Promise<void> {
  if (product.sourceOrigin !== "auto_seo" || product.gptJobId || !product.storeId || !product.productId) throw new Error("Invalid legacy Review sync outcome");
  const itemId = `${product.storeId}:${product.productId}`;
  const response = await fetch(`/api/seo-review/items/${encodeURIComponent(itemId)}/update?source=auto_seo`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: outcome }),
  });
  if (!response.ok) throw new Error(`Auto SEO sync receipt save failed (${response.status})`);
}

export async function loadAutoSeoReviews(storeId: string): Promise<readonly SeoProductUiViewModel[]> {
  const products: SeoProductUiViewModel[] = [];
  let offset = 0;
  while (true) {
    const response = await fetch(`/api/seo-review/items?source=auto_seo&storeId=${encodeURIComponent(storeId)}&limit=500&offset=${offset}`);
    if (!response.ok) throw new Error(`Auto SEO review reload failed (${response.status})`);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("items" in body) || !Array.isArray(body.items) || !("total" in body) || typeof body.total !== "number") {
      throw new Error("Invalid Auto SEO review response");
    }
    products.push(...(body.items as DurableAutoSeoReview[]).map(mapReview));
    offset += body.items.length;
    if (offset >= body.total || body.items.length === 0) return products;
  }
}

export async function loadAutoSeoReview(itemId: string, storeId: string, signal?: AbortSignal): Promise<SeoProductUiViewModel> {
  const response = await fetch(`/api/seo-review/items/${encodeURIComponent(itemId)}?source=auto_seo`, { signal });
  if (!response.ok) throw new Error(`Auto SEO review reload failed (${response.status})`);
  const body = await response.json() as { item: DurableAutoSeoReview };
  if (body.item?.storeId !== storeId) throw new Error("Review does not belong to the selected store");
  return mapReview(body.item);
}

export async function updateAutoSeoReviewStatus(product: SeoProductUiViewModel, status: "pending" | "approved" | "rejected", notes?: string): Promise<void> {
  if (product.sourceOrigin !== "auto_seo" || !product.storeId || !product.productId) return;
  const itemId = `${product.storeId}:${product.productId}`;
  const response = await fetch(`/api/seo-review/items/${encodeURIComponent(itemId)}/status?source=auto_seo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, notes }),
  });
  if (!response.ok) throw new Error(`Auto SEO review status update failed (${response.status})`);
}

export async function updateAutoSeoReviewPayload(product: SeoProductUiViewModel, updated: SeoProductEditInput): Promise<void> {
  if (product.sourceOrigin !== "auto_seo" || !product.storeId || !product.productId) return;
  const itemId = `${product.storeId}:${product.productId}`;
  const response = await fetch(`/api/seo-review/items/${encodeURIComponent(itemId)}/update?source=auto_seo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: {
      productTitle: updated.productTitle,
      productDescription: updated.productDescription,
      productSeoTitle: updated.seoTitle,
      productSeoDescription: updated.seoDescription,
      productHandle: updated.handle,
      imageAlts: updated.imageAlts.map(image => image.alt),
    } }),
  });
  if (!response.ok) throw new Error(`Auto SEO review edit failed (${response.status})`);
}
