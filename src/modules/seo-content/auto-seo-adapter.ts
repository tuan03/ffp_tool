import { runSeoContent } from "./service";
import type {
  SeoContentImageInput,
  SeoContentInput,
  SeoContentOutput,
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
  /** Số lượng sản phẩm xử lý đồng thời tối đa (mặc định: 3) */
  readonly concurrency?: number;
  /** Niche mặc định khi sản phẩm không có productType hoặc tags (mặc định: "General") */
  readonly defaultNiche?: string;
  /** Storefront domain shared by the batch, supplied by Gateway when available. */
  readonly siteDomain?: string;
}

/**
 * Kết quả xử lý SEO cho từng sản phẩm riêng lẻ trong danh sách Auto SEO.
 */
export interface AutoSeoItemResult {
  readonly productId: string;
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

/**
 * Chuyển đổi một sản phẩm từ module Auto SEO sang chuẩn `SeoContentInput` cho Pipeline SEO (B1 → B6).
 *
 * @param product Sản phẩm từ Shopify store hoặc payload tuyển chọn Auto SEO.
 * @param defaultNiche Ngành hàng dự phòng nếu sản phẩm thiếu productType và tags.
 * @returns Định dạng đầu vào chuẩn `SeoContentInput` cho pipeline SEO.
 */
export function fromAutoSeoProduct(
  product: AutoSeoSourceProduct,
  defaultNiche = "General",
): SeoContentInput {
  // 1. Xác định ID và Handle
  const rawId = typeof product.productId === "string" && product.productId.trim().length > 0
    ? product.productId
    : typeof product.id === "string" && product.id.trim().length > 0
      ? product.id
      : "";
  const productId = rawId.trim();
  const handle = (typeof product.handle === "string" ? product.handle : "").trim();

  // 2. Xác định Tiêu đề gốc
  const rawTitle = typeof product.sourceTitle === "string" && product.sourceTitle.trim().length > 0
    ? product.sourceTitle
    : typeof product.title === "string" && product.title.trim().length > 0
      ? product.title
      : "";
  const title = rawTitle.trim() || "Untitled Product";

  // 3. Xác định Mô tả gốc (HTML hoặc Plain text)
  let description = "";
  if (typeof product.sourceDescriptionHtml === "string" && product.sourceDescriptionHtml.trim().length > 0) {
    description = product.sourceDescriptionHtml.trim();
  } else if (typeof product.descriptionHtml === "string" && product.descriptionHtml.trim().length > 0) {
    description = product.descriptionHtml.trim();
  } else if (typeof product.description === "string" && product.description.trim().length > 0) {
    description = product.description.trim();
  }
  if (!description) {
    description = title;
  }

  // 4. Xác định Niche (Ưu tiên productType -> tags đầu tiên -> defaultNiche)
  let niche = defaultNiche;
  if (typeof product.productType === "string" && product.productType.trim().length > 0) {
    niche = product.productType.trim();
  } else if (Array.isArray(product.tags) && product.tags.length > 0) {
    const validTag = product.tags.find(
      (t: unknown): t is string => typeof t === "string" && t.trim().length > 0,
    );
    if (validTag) {
      niche = validTag.trim();
    }
  }

  // 5. Trích xuất danh sách ảnh (Khử trùng lặp URL và chuẩn hóa alt text)
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
      const rawAlt = typeof imgObj.altText === "string"
        ? imgObj.altText
        : typeof imgObj.alt === "string"
          ? imgObj.alt
          : undefined;
      const alt = rawAlt ? rawAlt.trim() : undefined;
      const rawImgId = typeof imgObj.id === "string" ? imgObj.id.trim() : undefined;

      images.push({
        url: trimmedUrl,
        ...(alt ? { alt } : {}),
        ...(rawImgId ? { id: rawImgId } : {}),
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
      const featAlt = typeof feat.altText === "string"
        ? feat.altText.trim()
        : typeof feat.alt === "string"
          ? feat.alt.trim()
          : undefined;
      images.push({
        url: featUrl,
        ...(featAlt ? { alt: featAlt } : {}),
      });
    }
  }

  return {
    ...(typeof product.onlineStoreUrl === "string" && product.onlineStoreUrl.trim()
      ? { siteDomain: product.onlineStoreUrl.trim() }
      : {}),
    title,
    description,
    niche,
    handle,
    images,
    ...(productId ? { productId } : {}),
    ...(typeof product.onlineStoreUrl === "string" && product.onlineStoreUrl ? { url: product.onlineStoreUrl } : {}),
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
  defaultNiche = "General",
): readonly SeoContentInput[] {
  return products.map((p) => fromAutoSeoProduct(p, defaultNiche));
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
  options: AutoSeoAdapterOptions = {},
): Promise<AutoSeoBatchResult> {
  const runner = options.runner || runSeoContent;
  const concurrency = Math.max(1, Math.min(options.concurrency || 3, 10));

  const items: AutoSeoItemResult[] = [];
  const seoOutputs: SeoContentOutput[] = [];

  for (let i = 0; i < products.length; i += concurrency) {
    const chunk = products.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (product): Promise<AutoSeoItemResult> => {
      const mappedInput = fromAutoSeoProduct(product, options.defaultNiche);
      const seoInput = options.siteDomain?.trim()
        ? { ...mappedInput, siteDomain: options.siteDomain.trim() }
        : mappedInput;
      const productId = seoInput.productId ?? "";
      const handle = seoInput.handle;

      try {
        const seoOutput = await runner(seoInput);
        return {
          productId,
          handle,
          sourceProduct: product,
          seoInput,
          seoOutput,
          success: true,
        };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          productId,
          handle,
          sourceProduct: product,
          seoInput,
          success: false,
          error: errorMessage,
        };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    for (const res of chunkResults) {
      items.push(res);
      if (res.success && res.seoOutput) {
        seoOutputs.push(res.seoOutput);
      }
    }
  }

  const successful = items.filter((it) => it.success).length;
  const failed = items.length - successful;

  return {
    total: items.length,
    successful,
    failed,
    items,
    seoOutputs,
  };
}
