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
 * Trích xuất nhãn biến thể phân biệt (ví dụ: "Pink Faith", "Be Still and Know")
 * từ splitContext hoặc variants của CrawlProduct.
 */
export function extractVariantLabel(product: CrawlProduct): string | undefined {
  if (
    product.splitContext
    && typeof product.splitContext.value === "string"
    && product.splitContext.value.trim().length > 0
  ) {
    return product.splitContext.value.trim();
  }
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    const firstVariant = product.variants[0] as { options?: Record<string, unknown> } | undefined;
    if (firstVariant && firstVariant.options && typeof firstVariant.options === "object") {
      const splitAttr = typeof product.splitContext?.attribute === "string" ? product.splitContext.attribute : undefined;
      if (splitAttr && typeof firstVariant.options[splitAttr] === "string" && (firstVariant.options[splitAttr] as string).trim().length > 0) {
        return (firstVariant.options[splitAttr] as string).trim();
      }
      const values = Object.values(firstVariant.options).filter(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      if (values.length > 0) {
        return values.map((v) => v.trim()).join(" / ");
      }
    }
  }
  return undefined;
}

/**
 * Trích xuất tên thuộc tính biến thể (ví dụ: "Color", "Design", "Size")
 * từ splitContext hoặc variants của CrawlProduct.
 */
export function extractVariantAttribute(product: CrawlProduct): string | undefined {
  if (
    product.splitContext
    && typeof product.splitContext.attribute === "string"
    && product.splitContext.attribute.trim().length > 0
  ) {
    return product.splitContext.attribute.trim();
  }
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    const firstVariant = product.variants[0] as { options?: Record<string, unknown> } | undefined;
    if (firstVariant && firstVariant.options && typeof firstVariant.options === "object") {
      const keys = Object.keys(firstVariant.options).filter((k) => k.trim().length > 0);
      if (keys.length > 0) {
        return keys[0].trim();
      }
    }
  }
  return undefined;
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
  const variantLabel = extractVariantLabel(product);
  const variantAttribute = extractVariantAttribute(product);

  // 1. Tiêu đề sản phẩm (gắn nhãn biến thể nếu chưa có trong tiêu đề gốc)
  const rawBaseTitle = (product.title || product.sourceTitle || "").trim() || "Custom Product";
  let title = rawBaseTitle;
  if (variantLabel && !title.toLowerCase().includes(variantLabel.toLowerCase())) {
    title = `${rawBaseTitle} - ${variantLabel}`;
  }

  // 2. Mô tả sản phẩm (Ghép description, bullet points và thông tin biến thể)
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
  if (variantLabel) {
    const attrName = variantAttribute || "Variant";
    const variantBullet = `• ${attrName}: ${variantLabel}`;
    const descCorpus = descriptionParts.join("\n\n");
    if (!descCorpus.toLowerCase().includes(variantLabel.toLowerCase())) {
      descriptionParts.push(variantBullet);
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

  // Đảm bảo ảnh đại diện của variant luôn nằm ở images[0]
  let variantImageUrl: string | undefined;
  let variantImageAlt: string | undefined;

  let targetVariant: Record<string, unknown> | undefined;
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    if (variantLabel) {
      const normLabel = variantLabel.trim().toLowerCase();
      const matched = product.variants.find((v) => {
        if (!v || typeof v !== "object") return false;
        const rec = v as Record<string, unknown>;
        if (typeof rec.title === "string" && rec.title.trim().toLowerCase() === normLabel) return true;
        if (typeof rec.name === "string" && rec.name.trim().toLowerCase() === normLabel) return true;
        if (rec.options && typeof rec.options === "object") {
          const vals = Object.values(rec.options as Record<string, unknown>);
          if (vals.some((val) => typeof val === "string" && val.trim().toLowerCase() === normLabel)) {
            return true;
          }
        }
        return false;
      });
      if (matched && typeof matched === "object") {
        targetVariant = matched as Record<string, unknown>;
      }
    }
    if (!targetVariant) {
      targetVariant = product.variants[0] as Record<string, unknown> | undefined;
    }
  }

  if (targetVariant) {
    const rawImageId = targetVariant.imageId ?? targetVariant.image_id;
    if (rawImageId && Array.isArray(product.media)) {
      const matchById = product.media.find(
        (m) => m && String(m.id ?? "").trim() === String(rawImageId).trim() && typeof m.url === "string" && m.url.trim(),
      );
      if (matchById && typeof matchById.url === "string") {
        variantImageUrl = matchById.url.trim();
        if (typeof matchById.alt === "string") {
          variantImageAlt = matchById.alt.trim();
        }
      }
    }

    if (!variantImageUrl) {
      if (typeof targetVariant.imageUrl === "string" && targetVariant.imageUrl.trim()) {
        variantImageUrl = targetVariant.imageUrl.trim();
      } else if (typeof targetVariant.mediaUrl === "string" && targetVariant.mediaUrl.trim()) {
        variantImageUrl = targetVariant.mediaUrl.trim();
      } else if (typeof targetVariant.image === "string" && targetVariant.image.trim()) {
        variantImageUrl = targetVariant.image.trim();
      } else if (targetVariant.image && typeof targetVariant.image === "object" && typeof (targetVariant.image as Record<string, unknown>).url === "string") {
        variantImageUrl = ((targetVariant.image as Record<string, unknown>).url as string).trim();
        if (typeof (targetVariant.image as Record<string, unknown>).alt === "string") {
          variantImageAlt = ((targetVariant.image as Record<string, unknown>).alt as string).trim();
        }
      } else if (targetVariant.featuredImage && typeof targetVariant.featuredImage === "object" && typeof (targetVariant.featuredImage as Record<string, unknown>).url === "string") {
        variantImageUrl = ((targetVariant.featuredImage as Record<string, unknown>).url as string).trim();
        if (typeof (targetVariant.featuredImage as Record<string, unknown>).alt === "string") {
          variantImageAlt = ((targetVariant.featuredImage as Record<string, unknown>).alt as string).trim();
        }
      } else if (targetVariant.featuredImage && typeof targetVariant.featuredImage === "string" && targetVariant.featuredImage.trim()) {
        variantImageUrl = targetVariant.featuredImage.trim();
      } else if (Array.isArray(targetVariant.media) && targetVariant.media.length > 0) {
        const firstMedia = targetVariant.media[0] as { url?: string; alt?: string } | undefined;
        if (firstMedia && typeof firstMedia.url === "string" && firstMedia.url.trim()) {
          variantImageUrl = firstMedia.url.trim();
          variantImageAlt = typeof firstMedia.alt === "string" ? firstMedia.alt.trim() : undefined;
        }
      }
    }
  }

  if (!variantImageUrl && product.splitContext && typeof product.splitContext === "object") {
    const sc = product.splitContext as Record<string, unknown>;
    if (typeof sc.imageUrl === "string" && sc.imageUrl.trim()) {
      variantImageUrl = sc.imageUrl.trim();
    } else if (typeof sc.thumbnailUrl === "string" && sc.thumbnailUrl.trim()) {
      variantImageUrl = sc.thumbnailUrl.trim();
    } else if (sc.image && typeof sc.image === "object" && typeof (sc.image as Record<string, unknown>).url === "string") {
      variantImageUrl = ((sc.image as Record<string, unknown>).url as string).trim();
    }
  }

  // Nếu variant có ASIN riêng (hoặc splitContext.sourceAsins) và trong product.media có item gán sourceAsin khớp
  const targetAsins = new Set<string>();
  if (product.asin && typeof product.asin === "string" && product.asin.trim()) {
    targetAsins.add(product.asin.trim().toLowerCase());
  }
  if (product.splitContext && typeof product.splitContext === "object") {
    const sc = product.splitContext as Record<string, unknown>;
    if (Array.isArray(sc.sourceAsins)) {
      for (const a of sc.sourceAsins) {
        if (typeof a === "string" && a.trim()) {
          targetAsins.add(a.trim().toLowerCase());
        }
      }
    }
  }
  if (!variantImageUrl && targetAsins.size > 0 && Array.isArray(product.media)) {
    const matchingMedia = product.media.find(
      (m) =>
        m
        && String(m.kind ?? "image").toLowerCase() !== "video"
        && typeof m.sourceAsin === "string"
        && targetAsins.has(m.sourceAsin.trim().toLowerCase())
        && typeof m.url === "string"
        && m.url.trim(),
    );
    if (matchingMedia && typeof matchingMedia.url === "string") {
      variantImageUrl = matchingMedia.url.trim();
      if (typeof matchingMedia.alt === "string") {
        variantImageAlt = matchingMedia.alt.trim();
      }
    }
  }

  // Nếu trong product.media có item mà alt chứa variantLabel
  if (!variantImageUrl && variantLabel && Array.isArray(product.media)) {
    const matchingMedia = product.media.find(
      (m) =>
        m
        && String(m.kind ?? "image").toLowerCase() !== "video"
        && typeof m.alt === "string"
        && m.alt.toLowerCase().includes(variantLabel.toLowerCase())
        && typeof m.url === "string"
        && m.url.trim(),
    );
    if (matchingMedia && typeof matchingMedia.url === "string") {
      variantImageUrl = matchingMedia.url.trim();
      if (typeof matchingMedia.alt === "string") {
        variantImageAlt = matchingMedia.alt.trim();
      }
    }
  }

  // Đặt variantImageUrl lên vị trí đầu tiên (images[0])
  if (variantImageUrl) {
    const existingIndex = images.findIndex((img) => img.url === variantImageUrl);
    if (existingIndex > 0) {
      const [found] = images.splice(existingIndex, 1);
      images.unshift(found);
    } else if (existingIndex === -1) {
      images.unshift({
        url: variantImageUrl,
        alt: variantImageAlt || (variantLabel ? `${title} - ${variantLabel}` : undefined),
      });
    } else if (existingIndex === 0 && !images[0].alt && variantImageAlt) {
      images[0] = { ...images[0], alt: variantImageAlt };
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
    variantLabel,
    ...(product.id ? { productId: product.id } : {}),
    ...(product.canonicalUrl ? { url: product.canonicalUrl } : {}),
    ...((product as Record<string, unknown>).storeId
      ? { storeId: String((product as Record<string, unknown>).storeId) }
      : {}),
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

  const splitVal = extractVariantLabel(product);
  const rawId = product.sourceKey
    || (product.id && !product.id.startsWith("job-") ? product.id : undefined)
    || (product.parentAsin && splitVal ? `${product.parentAsin}-${splitVal}` : undefined)
    || (product.asin && splitVal ? `${product.asin}-${splitVal}` : undefined)
    || product.id
    || product.parentAsin
    || product.asin
    || "product";
  const identity = String(rawId);
  const splitValue = splitVal || (identity.split(":").at(-1) ?? identity);
  const readableSuffix = slugifyHandlePart(splitValue).slice(0, 24) || "product";
  const suffix = `${readableSuffix}-${stableHandleHash(identity)}`;
  const maxHandleLength = 80;
  const base = slugifyHandlePart(generatedHandle) || "product";
  const availableBaseLength = Math.max(1, maxHandleLength - suffix.length - 1);
  const trimmedBase = base.slice(0, availableBaseLength).replace(/-+$/g, "") || "product";
  return `${trimmedBase}-${suffix}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function composeVariantTitle(baseTitle: string, variantLabel: string, maxLen = 100): string {
  const suffix = ` - ${variantLabel}`;
  if (baseTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
    if (baseTitle.length <= maxLen) {
      return baseTitle;
    }
    const prefixPart = baseTitle.slice(0, baseTitle.length - suffix.length).trim();
    const available = Math.max(15, maxLen - suffix.length);
    const trimmedPrefix = prefixPart.slice(0, available).replace(/\s*-\s*$/, "").trim();
    return `${trimmedPrefix}${suffix}`;
  }

  if (baseTitle.toLowerCase().includes(variantLabel.toLowerCase())) {
    if (baseTitle.length <= maxLen) {
      return baseTitle;
    }
    const stripped = baseTitle.replace(/\s*([|•\-–—:]\s*[^|•\-–—:]+)+$/, "").trim();
    if (stripped.length <= maxLen && stripped.toLowerCase().includes(variantLabel.toLowerCase())) {
      return stripped;
    }
    const rawWithout = baseTitle.replace(new RegExp(`\\s*-\\s*${escapeRegExp(variantLabel)}`, "gi"), "").trim();
    const available = Math.max(15, maxLen - suffix.length);
    const trimmedBase = rawWithout.slice(0, available).replace(/\s*-\s*$/, "").trim();
    return `${trimmedBase}${suffix}`;
  }

  if (baseTitle.length + suffix.length <= maxLen) {
    return `${baseTitle}${suffix}`;
  }
  const available = Math.max(15, maxLen - suffix.length);
  const trimmedBase = baseTitle.slice(0, available).replace(/\s*-\s*$/, "").trim();
  return `${trimmedBase}${suffix}`;
}

function composeVariantSeoTitle(baseSeoTitle: string, variantLabel: string, maxLen = 70): string {
  const suffix = ` - ${variantLabel}`;

  if (baseSeoTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
    if (baseSeoTitle.length <= maxLen) {
      return baseSeoTitle;
    }
    const prefixPart = baseSeoTitle.slice(0, baseSeoTitle.length - suffix.length).trim();
    const strippedPrefix = prefixPart.replace(/\s*([|•\-–—:]\s*[^|•\-–—:]+)+$/, "").trim();
    const targetPrefix = strippedPrefix.length > 0 ? strippedPrefix : prefixPart;
    const available = Math.max(15, maxLen - suffix.length);
    const words = targetPrefix.split(/\s+/);
    const selected: string[] = [];
    let currentLen = 0;
    for (const word of words) {
      const nextLen = selected.length === 0 ? word.length : currentLen + 1 + word.length;
      if (nextLen <= available) {
        selected.push(word);
        currentLen = nextLen;
      } else {
        break;
      }
    }
    const cleanPrefix = selected.length > 0 ? selected.join(" ") : targetPrefix.slice(0, available);
    return `${cleanPrefix.replace(/\s*-\s*$/, "").trim()}${suffix}`;
  }

  if (baseSeoTitle.toLowerCase().includes(variantLabel.toLowerCase())) {
    if (baseSeoTitle.length <= maxLen) {
      return baseSeoTitle;
    }
    const stripped = baseSeoTitle.replace(/\s*([|•\-–—:]\s*[^|•\-–—:]+)+$/, "").trim();
    if (stripped.length <= maxLen && stripped.toLowerCase().includes(variantLabel.toLowerCase())) {
      return stripped;
    }
    const rawWithout = baseSeoTitle.replace(new RegExp(`\\s*-\\s*${escapeRegExp(variantLabel)}`, "gi"), "").trim();
    const available = Math.max(15, maxLen - suffix.length);
    const words = rawWithout.split(/\s+/);
    const selected: string[] = [];
    let currentLen = 0;
    for (const word of words) {
      const nextLen = selected.length === 0 ? word.length : currentLen + 1 + word.length;
      if (nextLen <= available) {
        selected.push(word);
        currentLen = nextLen;
      } else {
        break;
      }
    }
    const cleanPrefix = selected.length > 0 ? selected.join(" ") : rawWithout.slice(0, available);
    return `${cleanPrefix.replace(/\s*-\s*$/, "").trim()}${suffix}`;
  }

  if (baseSeoTitle.length + suffix.length <= maxLen) {
    return `${baseSeoTitle}${suffix}`;
  }

  // Try stripping common trailing brand/pipe suffix first: e.g. " | Shop Online" or " | Quality & Style"
  const stripped = baseSeoTitle.replace(/\s*([|•\-–—:]\s*[^|•\-–—:]+)+$/, "").trim();
  if (stripped.length > 0 && stripped.length + suffix.length <= maxLen) {
    return `${stripped}${suffix}`;
  }

  const available = Math.max(15, maxLen - suffix.length);
  const words = stripped.length > 0 ? stripped.split(/\s+/) : baseSeoTitle.split(/\s+/);
  const selected: string[] = [];
  let currentLen = 0;
  for (const word of words) {
    const nextLen = selected.length === 0 ? word.length : currentLen + 1 + word.length;
    if (nextLen <= available) {
      selected.push(word);
      currentLen = nextLen;
    } else {
      break;
    }
  }
  const cleanPrefix = selected.length > 0 ? selected.join(" ") : baseSeoTitle.slice(0, available);
  return `${cleanPrefix.replace(/\s*-\s*$/, "").trim()}${suffix}`;
}

function composeVariantSeoDescription(baseSeoDesc: string, variantLabel: string, maxLen = 160): string {
  if (baseSeoDesc.toLowerCase().includes(variantLabel.toLowerCase())) {
    return baseSeoDesc.length <= maxLen ? baseSeoDesc : baseSeoDesc.slice(0, maxLen);
  }
  const tag = ` - ${variantLabel}`;
  if (baseSeoDesc.length + tag.length <= maxLen) {
    if (/(\.\s*(Shop now!?|Order now!?|Buy now!?))$/i.test(baseSeoDesc)) {
      return baseSeoDesc.replace(/(\.\s*(Shop now!?|Order now!?|Buy now!?))$/i, `${tag}.$1`);
    }
    return `${baseSeoDesc.replace(/\.*$/, "")}${tag}.`;
  }
  const available = Math.max(30, maxLen - tag.length - 1);
  const words = baseSeoDesc.split(/\s+/);
  const selected: string[] = [];
  let currentLen = 0;
  for (const word of words) {
    const nextLen = selected.length === 0 ? word.length : currentLen + 1 + word.length;
    if (nextLen <= available) {
      selected.push(word);
      currentLen = nextLen;
    } else {
      break;
    }
  }
  const cleanPrefix = selected.length > 0 ? selected.join(" ") : baseSeoDesc.slice(0, available);
  return `${cleanPrefix.replace(/\.*$/, "")}${tag}.`;
}

function composeVariantDescriptionHtml(baseHtml: string, variantLabel: string, variantAttribute?: string): string {
  if (baseHtml.toLowerCase().includes(variantLabel.toLowerCase())) {
    return baseHtml;
  }
  const attr = variantAttribute || "Variant";
  const itemHtml = `<li><strong>${attr}:</strong> ${variantLabel}</li>`;
  if (baseHtml.includes("</ul>")) {
    return baseHtml.replace("</ul>", `  ${itemHtml}\n</ul>`);
  }
  return `${baseHtml}\n<p><strong>${attr}:</strong> ${variantLabel}</p>`;
}

export function applySeoContentToCustomizationProduct(
  product: CrawlProduct,
  seoOutput: SeoContentOutput | SeoContentAltOnlyOutput,
  options?: ApplySeoContentOptions,
): CrawlProduct {
  const altBySourceUrl = new Map(
    seoOutput.images.map((image) => [image.sourceUrl, image.alt] as const),
  );

  const variantLabel = extractVariantLabel(product);
  const variantAttribute = extractVariantAttribute(product);
  const finalTitle = variantLabel
    ? composeVariantTitle(seoOutput.productTitle, variantLabel)
    : seoOutput.productTitle;
  const finalSeoTitle = variantLabel
    ? composeVariantSeoTitle(seoOutput.productSeoTitle, variantLabel)
    : seoOutput.productSeoTitle;
  const finalSeoDescription = variantLabel
    ? composeVariantSeoDescription(seoOutput.productSeoDescription, variantLabel)
    : seoOutput.productSeoDescription;
  const finalDescriptionHtml = variantLabel
    ? composeVariantDescriptionHtml(seoOutput.productDescription, variantLabel, variantAttribute)
    : seoOutput.productDescription;

  return {
    ...product,
    title: finalTitle,
    descriptionHtml: finalDescriptionHtml,
    handle: resolveProductHandle(product, seoOutput.productHandle, options),
    seo: {
      title: finalSeoTitle,
      description: finalSeoDescription,
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
        const rawSeoOutput = await runner(seoInput);
        const variantLabel = extractVariantLabel(product);
        const variantAttribute = extractVariantAttribute(product);
        const seoOutput: SeoContentOutput = variantLabel
          ? {
              ...rawSeoOutput,
              productTitle: composeVariantTitle(rawSeoOutput.productTitle, variantLabel),
              productSeoTitle: composeVariantSeoTitle(rawSeoOutput.productSeoTitle, variantLabel),
              productSeoDescription: composeVariantSeoDescription(rawSeoOutput.productSeoDescription, variantLabel),
              productDescription: composeVariantDescriptionHtml(rawSeoOutput.productDescription, variantLabel, variantAttribute),
              productHandle: resolveProductHandle(product, rawSeoOutput.productHandle, { ensureUniqueHandle: true }),
            }
          : rawSeoOutput;
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
