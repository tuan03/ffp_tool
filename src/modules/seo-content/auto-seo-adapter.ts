import { createSeoContentQueue } from "./queue";
import type { SeoQueueProgressStats } from "./queue";
import { runDefaultSeoContent } from "./default-runner";
import type {
  SeoContentImageInput,
  SeoContentInput,
  SeoContentOutput,
  SeoStoreProfile,
} from "./types";

/**
 * Cấu trúc hình ảnh đầu vào từ module Auto SEO / Shopify.
 */
export interface AutoSeoProductImageInput {
  readonly id?: string;
  readonly url?: string;
  readonly src?: string;
  readonly altText?: string | null;
  readonly alt?: string | null;
  readonly position?: number;
}

/**
 * Cấu trúc sản phẩm đầu vào linh hoạt từ module Auto SEO, hỗ trợ cả ShopifyProduct,
 * AutoSeoCandidate và SeoContentInputPayload.
 */
export interface AutoSeoSourceProduct {
  readonly id?: string;
  readonly storeId?: string;
  readonly productId?: string;
  readonly title?: string;
  readonly sourceTitle?: string;
  readonly handle?: string;
  readonly description?: string;
  readonly descriptionHtml?: string;
  readonly sourceDescriptionHtml?: string;
  readonly productType?: string;
  readonly tags?: readonly (string | unknown)[];
  readonly onlineStoreUrl?: string;
  readonly featuredImage?: AutoSeoProductImageInput | unknown;
  readonly images?: readonly (AutoSeoProductImageInput | unknown)[];
  readonly [key: string]: unknown;
}

/**
 * Tùy chọn thực thi bộ điều phối SEO cho danh sách sản phẩm từ Auto SEO.
 */
export interface AutoSeoAdapterOptions {
  /** Runner tùy chỉnh (hỗ trợ dependency injection hoặc testing) */
  readonly runner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
  /** Số lượng sản phẩm xử lý đồng thời tối đa (mặc định: 1, tối đa: 3) */
  readonly concurrency?: number;
  /** Niche mặc định khi sản phẩm không có productType hoặc tags (mặc định: "General") */
  readonly defaultNiche?: string;
  /** Explicit, versioned configuration resolved before entering SEO Content. */
  readonly storeProfile: SeoStoreProfile;
  /** Callback phát sự kiện ngay khi một sản phẩm hoàn tất xử lý */
  readonly onItemCompleted?: (itemResult: AutoSeoItemResult) => void;
  /** Callback phát sự kiện ngay khi một sản phẩm xử lý thất bại */
  readonly onItemFailed?: (itemResult: AutoSeoItemResult) => void;
  /** Callback phát sự kiện tiến độ tổng thể của batch */
  readonly onProgress?: (stats: SeoQueueProgressStats) => void;
}

/**
 * Kết quả xử lý SEO cho từng sản phẩm riêng lẻ trong danh sách Auto SEO.
 */
export interface AutoSeoItemResult {
  readonly productId: string;
  readonly storeId?: string;
  readonly handle: string;
  readonly sourceProduct: AutoSeoSourceProduct;
  readonly seoInput: SeoContentInput;
  readonly seoOutput?: SeoContentOutput;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Kết quả tổng hợp của toàn bộ lô sản phẩm Auto SEO sau khi chuẩn hóa SEO.
 */
export interface AutoSeoBatchResult {
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  /** Danh sách chi tiết kết quả từng sản phẩm (kèm dữ liệu nguồn + SEO output) */
  readonly items: readonly AutoSeoItemResult[];
  /** Danh sách JSON thuần các sản phẩm đã chuẩn hóa SEO (sẵn sàng hiển thị lên UI hoặc sync) */
  readonly seoOutputs: readonly SeoContentOutput[];
}

function stableImageId(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `image-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Chuyển đổi một sản phẩm từ module Auto SEO sang chuẩn `SeoContentInput` cho Pipeline SEO (B1 → B6).
 *
 * @param product Sản phẩm từ Shopify store hoặc payload tuyển chọn Auto SEO.
 * @param defaultNiche Ngành hàng dự phòng nếu sản phẩm thiếu productType và tags.
 * @returns Định dạng đầu vào chuẩn `SeoContentInput` cho pipeline SEO.
 */
export function fromAutoSeoProduct(
  product: AutoSeoSourceProduct,
  niche: string,
  storeProfile: SeoStoreProfile,
): SeoContentInput {
  // Image pixels are the sole product-specific evidence. Ignore title,
  // description, handle, variants, tags, product type and old alt text.
  const images: SeoContentImageInput[] = [];
  const seenUrls = new Set<string>();

  const rawImages: readonly unknown[] = Array.isArray(product.images) ? product.images : [];

  for (const img of rawImages) {
    if (!img || typeof img !== "object") continue;

    const imgObj = img as Record<string, unknown>;
    const rawUrl = typeof imgObj.url === "string"
      ? imgObj.url
      : typeof imgObj.src === "string"
        ? imgObj.src
        : "";
    const trimmedUrl = rawUrl.trim();

    if (trimmedUrl && !seenUrls.has(trimmedUrl)) {
      seenUrls.add(trimmedUrl);
      const rawImgId = typeof imgObj.id === "string" ? imgObj.id.trim() : undefined;

      images.push({
        id: rawImgId || stableImageId(trimmedUrl),
        url: trimmedUrl,
      });
    }
  }

  // Nếu không có ảnh trong `images`, kiểm tra `featuredImage` (nếu có)
  if (images.length === 0 && product.featuredImage && typeof product.featuredImage === "object") {
    const feat = product.featuredImage as Record<string, unknown>;
    const featUrl = typeof feat.url === "string"
      ? feat.url.trim()
      : typeof feat.src === "string"
        ? feat.src.trim()
        : "";
    if (featUrl && !seenUrls.has(featUrl)) {
      images.push({
        id: typeof feat.id === "string" && feat.id.trim() ? feat.id.trim() : stableImageId(featUrl),
        url: featUrl,
      });
    }
  }

  return {
    images,
    niche: niche.trim() || storeProfile.niche,
    storeProfile,
  };
}

/**
 * Chuyển đổi toàn bộ danh sách sản phẩm Auto SEO sang mảng `SeoContentInput`.
 *
 * @param products Danh sách sản phẩm từ Auto SEO.
 * @param defaultNiche Ngành hàng dự phòng.
 * @returns Mảng `SeoContentInput[]` chuẩn hóa sẵn sàng cho pipeline SEO.
 */
export function fromAutoSeoBatch(
  products: readonly AutoSeoSourceProduct[],
  niche: string,
  storeProfile: SeoStoreProfile,
): readonly SeoContentInput[] {
  return products.map((p) => fromAutoSeoProduct(p, niche, storeProfile));
}

/**
 * Hàm điều phối chính (Core Auto SEO Adapter Function):
 * Nhận danh sách sản phẩm từ module Auto SEO, tự động chuyển đổi và thực thi pipeline SEO (B1 → B6),
 * trả về danh sách JSON các sản phẩm đã được chuẩn hóa SEO toàn diện cho Orchestrator/Gateway hiển thị hoặc đồng bộ.
 *
 * @param products Danh sách sản phẩm Auto SEO cần tối ưu.
 * @param options Tùy chọn concurrency, runner mock/real, default niche.
 * @returns Kết quả batch SEO chứa mảng JSON các sản phẩm đã chuẩn hóa SEO (`seoOutputs`).
 */
export async function runAutoSeoPipeline(
  products: readonly AutoSeoSourceProduct[],
  options: AutoSeoAdapterOptions,
): Promise<AutoSeoBatchResult> {
  if (products.length === 0) {
    return {
      total: 0,
      successful: 0,
      failed: 0,
      items: [],
      seoOutputs: [],
    };
  }

  const baseRunner = options.runner || runDefaultSeoContent;
  const rawConcurrency = typeof options.concurrency === "number" && !Number.isNaN(options.concurrency)
    ? options.concurrency
    : 1;
  const concurrency = Math.max(1, Math.min(Math.floor(rawConcurrency), 3));

  interface IndexedItem {
    readonly index: number;
    readonly result: AutoSeoItemResult;
    readonly seoOutput?: SeoContentOutput;
  }
  const collectedItems: IndexedItem[] = [];

  const queue = createSeoContentQueue<AutoSeoSourceProduct>({
    concurrency,
    runner: async (seoInput) => baseRunner(seoInput),
    onItemCompleted: (item, seoOutput) => {
      const product = item.source as AutoSeoSourceProduct;
      const itemResult: AutoSeoItemResult = {
        productId: typeof product.productId === "string" ? product.productId : typeof product.id === "string" ? product.id : "",
        storeId: typeof product.storeId === "string" && product.storeId.trim().length > 0
          ? product.storeId.trim()
          : undefined,
        handle: typeof product.handle === "string" ? product.handle : "",
        sourceProduct: product,
        seoInput: item.seoInput,
        seoOutput,
        success: true,
      };
      collectedItems.push({ index: item.index, result: itemResult, seoOutput });
      options.onItemCompleted?.(itemResult);
    },
    onItemFailed: (item, error) => {
      const product = item.source as AutoSeoSourceProduct;
      const itemResult: AutoSeoItemResult = {
        productId: typeof product.productId === "string" ? product.productId : typeof product.id === "string" ? product.id : "",
        storeId: typeof product.storeId === "string" && product.storeId.trim().length > 0
          ? product.storeId.trim()
          : undefined,
        handle: typeof product.handle === "string" ? product.handle : "",
        sourceProduct: product,
        seoInput: item.seoInput,
        success: false,
        error,
      };
      collectedItems.push({ index: item.index, result: itemResult });
      options.onItemCompleted?.(itemResult);
      options.onItemFailed?.(itemResult);
    },
    onProgress: (stats) => {
      options.onProgress?.(stats);
    },
  });

  const inputs = products.map((product) => {
    return fromAutoSeoProduct(product, options.defaultNiche ?? options.storeProfile.niche, options.storeProfile);
  });

  queue.enqueue(inputs, products);
  await queue.waitForDrain();

  collectedItems.sort((a, b) => a.index - b.index);
  const items = collectedItems.map((entry) => entry.result);
  const orderedOutputs = collectedItems
    .filter((entry): entry is IndexedItem & { seoOutput: SeoContentOutput } => entry.result.success && Boolean(entry.seoOutput))
    .map((entry) => entry.seoOutput);

  const successful = items.filter((it) => it.success).length;
  const failed = items.length - successful;

  return {
    total: items.length,
    successful,
    failed,
    items,
    seoOutputs: orderedOutputs,
  };
}
