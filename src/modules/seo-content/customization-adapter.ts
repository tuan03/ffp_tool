import type { CrawlProduct, CustomizationNormalizerOutput } from "../customization-normalizer";
import { runSeoContent } from "./service";
import type {
  SeoContentAltOnlyOutput,
  SeoContentImageInput,
  SeoContentInput,
  SeoContentOutput,
} from "./types";

/**
 * Tùy chọn thực thi bộ điều phối SEO cho danh sách sản phẩm từ Customization.
 */
export interface CustomizationSeoOptions {
  /** Runner tùy chỉnh (hỗ trợ dependency injection hoặc testing) */
  readonly runner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
  /** Số lượng sản phẩm xử lý đồng thời tối đa (mặc định: 3) */
  readonly concurrency?: number;
  /** Niche mặc định khi sản phẩm không có danh mục (mặc định: "custom product") */
  readonly defaultNiche?: string;
}

/**
 * Kết quả xử lý SEO cho từng sản phẩm riêng lẻ trong lô hàng.
 */
export interface CustomizationSeoItemResult {
  readonly productId?: string;
  readonly asin?: string;
  readonly sourceProduct: CrawlProduct;
  readonly seoInput: SeoContentInput;
  readonly seoOutput?: SeoContentOutput;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Kết quả tổng hợp của toàn bộ lô sản phẩm Customization sau khi chuẩn hóa SEO.
 */
export interface CustomizationSeoBatchResult {
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  /** Danh sách chi tiết kết quả từng sản phẩm (kèm dữ liệu nguồn + SEO output) */
  readonly items: readonly CustomizationSeoItemResult[];
  /** Danh sách JSON thuần các sản phẩm đã chuẩn hóa SEO (sẵn sàng hiển thị lên UI) */
  readonly seoOutputs: readonly SeoContentOutput[];
}

/**
 * Chuyển đổi một sản phẩm `CrawlProduct` từ module Customization sang `SeoContentInput` cho module SEO Content.
 *
 * @param product Sản phẩm đã chuẩn hóa từ Customization Normalizer.
 * @param defaultNiche Ngành hàng dự phòng nếu sản phẩm thiếu thông tin categories.
 * @returns Định dạng đầu vào chuẩn `SeoContentInput` cho pipeline SEO B1 → B6.
 */
export function fromCustomizationProduct(
  product: CrawlProduct,
  defaultNiche = "custom product",
): SeoContentInput {
  // 1. Tiêu đề sản phẩm
  const title = (product.title || product.sourceTitle || "").trim() || "Custom Product";

  // 2. Mô tả sản phẩm (Ghép description và bullet points thành văn bản mô tả giàu dữ kiện)
  const descriptionParts: string[] = [];
  if (product.description && product.description.trim()) {
    descriptionParts.push(product.description.trim());
  }
  if (Array.isArray(product.bulletPoints) && product.bulletPoints.length > 0) {
    const bullets = product.bulletPoints
      .map((b) => (typeof b === "string" ? b.trim() : ""))
      .filter((b) => b.length > 0);
    if (bullets.length > 0) {
      descriptionParts.push(bullets.map((b) => `• ${b}`).join("\n"));
    }
  }
  const description = descriptionParts.join("\n\n") || title;

  // 3. Xác định Niche từ breadcrumbs categories (chọn cấp chi tiết nhất ở cuối danh sách)
  let niche = defaultNiche;
  if (Array.isArray(product.categories) && product.categories.length > 0) {
    const validCategories = product.categories
      .map((c) => (typeof c === "string" ? c.trim() : ""))
      .filter((c) => c.length > 0);
    if (validCategories.length > 0) {
      niche = validCategories[validCategories.length - 1];
    }
  }

  // 4. Trích xuất danh sách ảnh từ media
  const images: SeoContentImageInput[] = [];
  const seenUrls = new Set<string>();

  if (Array.isArray(product.media)) {
    for (const item of product.media) {
      if (
        item
        && String(item.kind ?? "image").toLowerCase() !== "video"
        && typeof item.url === "string"
        && item.url.trim().length > 0
      ) {
        const trimmedUrl = item.url.trim();
        if (!seenUrls.has(trimmedUrl)) {
          seenUrls.add(trimmedUrl);
          images.push({
            url: trimmedUrl,
            alt: typeof item.alt === "string" && item.alt.trim().length > 0 ? item.alt.trim() : undefined,
          });
        }
      }
    }
  }

  // 5. Handle / URL Slug (B5 sẽ tự sinh slug chuẩn nếu handle rỗng)
  const handle = typeof product.handle === "string" ? product.handle.trim() : "";

  return {
    title,
    description,
    niche,
    images,
    handle,
    ...(product.id ? { productId: product.id } : {}),
    ...(product.canonicalUrl ? { url: product.canonicalUrl } : {}),
  };
}

export interface ApplySeoContentOptions {
  readonly ensureUniqueHandle?: boolean;
  readonly existingShopifyHandle?: string;
}

function slugifyHandlePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableHandleHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function resolveProductHandle(
  product: CrawlProduct,
  generatedHandle: string,
  options?: ApplySeoContentOptions,
): string {
  const existingHandle = options?.existingShopifyHandle?.trim();
  if (existingHandle) return existingHandle;
  if (!options?.ensureUniqueHandle) return generatedHandle;

  const identity = String(product.sourceKey || product.id || product.parentAsin || product.asin || "product");
  const splitValue = identity.split(":").at(-1) ?? identity;
  const readableSuffix = slugifyHandlePart(splitValue).slice(0, 24) || "product";
  const suffix = `${readableSuffix}-${stableHandleHash(identity)}`;
  const maxHandleLength = 80;
  const base = slugifyHandlePart(generatedHandle) || "product";
  const availableBaseLength = Math.max(1, maxHandleLength - suffix.length - 1);
  const trimmedBase = base.slice(0, availableBaseLength).replace(/-+$/g, "") || "product";
  return `${trimmedBase}-${suffix}`;
}

export function applySeoContentToCustomizationProduct(
  product: CrawlProduct,
  seoOutput: SeoContentOutput | SeoContentAltOnlyOutput,
  options?: ApplySeoContentOptions,
): CrawlProduct {
  const altBySourceUrl = new Map(
    seoOutput.images.map((image) => [image.sourceUrl, image.alt] as const),
  );
  return {
    ...product,
    title: seoOutput.productTitle,
    descriptionHtml: seoOutput.productDescription,
    handle: resolveProductHandle(product, seoOutput.productHandle, options),
    seo: {
      title: seoOutput.productSeoTitle,
      description: seoOutput.productSeoDescription,
    },
    media: product.media?.map((media) => {
      if (String(media.kind ?? "image").toLowerCase() === "video") return { ...media };
      const alt = altBySourceUrl.get(media.url.trim());
      return alt ? { ...media, alt } : { ...media };
    }),
  };
}

/**
 * Chuyển đổi toàn bộ danh sách sản phẩm hoặc batch output từ Customization sang mảng `SeoContentInput`.
 *
 * @param batch Output từ Customization Normalizer hoặc mảng CrawlProduct.
 * @param defaultNiche Ngành hàng dự phòng.
 * @returns Mảng `SeoContentInput[]` đã sẵn sàng đưa vào xử lý SEO.
 */
export function fromCustomizationBatch(
  batch: CustomizationNormalizerOutput | readonly CrawlProduct[],
  defaultNiche = "custom product",
): readonly SeoContentInput[] {
  const products = Array.isArray(batch)
    ? batch
    : (batch as CustomizationNormalizerOutput).products || [];
  return products.map((p) => fromCustomizationProduct(p, defaultNiche));
}

/**
 * Hàm điều phối chính (Core Adapter Function):
 * Nhận danh sách sản phẩm từ module Customization, tự động chuyển đổi và thực thi pipeline SEO (B1 → B6),
 * trả về danh sách JSON các sản phẩm đã được tối ưu SEO toàn diện cho Orchestrator hiển thị lên UI.
 *
 * @param input Danh sách sản phẩm cào được hoặc kết quả từ Customization Normalizer.
 * @param options Tùy chọn concurrency, runner mock/real, default niche.
 * @returns Kết quả batch SEO chứa mảng JSON các sản phẩm đã chuẩn hóa SEO (`seoOutputs`).
 */
export async function runCustomizationSeoPipeline(
  input: CustomizationNormalizerOutput | readonly CrawlProduct[],
  options: CustomizationSeoOptions = {},
): Promise<CustomizationSeoBatchResult> {
  const products = Array.isArray(input)
    ? input
    : (input as CustomizationNormalizerOutput).products || [];
  const runner = options.runner || runSeoContent;
  const concurrency = Math.max(1, Math.min(options.concurrency || 3, 10));

  const items: CustomizationSeoItemResult[] = [];
  const seoOutputs: SeoContentOutput[] = [];

  // Xử lý từng cụm sản phẩm với kiểm soát concurrency an toàn
  for (let i = 0; i < products.length; i += concurrency) {
    const chunk = products.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (product): Promise<CustomizationSeoItemResult> => {
      const seoInput = fromCustomizationProduct(product, options.defaultNiche);
      try {
        const seoOutput = await runner(seoInput);
        return {
          productId: product.id,
          asin: product.asin || product.parentAsin,
          sourceProduct: product,
          seoInput,
          seoOutput,
          success: true,
        };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          productId: product.id,
          asin: product.asin || product.parentAsin,
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
