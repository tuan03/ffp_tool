import { createSeoContentQueue } from "./queue";
import type { SeoQueueProgressStats } from "./queue";
import { runSeoContent } from "./service";
import type {
  SeoContentImageInput,
  SeoContentInput,
  SeoContentOutput,
} from "./types";

/**
 * Thông số file in xưởng chất lượng cao từ Pinterest POD (300 DPI).
 */
export interface PodPrintMasterSpec {
  readonly cmykUrl?: string;
  readonly rgbUrl?: string;
  readonly localFilePath?: string;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly dpi?: number;
}

/**
 * Phôi sản phẩm bóc tách nền trắng và nền trong suốt.
 */
export interface PodCutoutSpec {
  readonly transparentUrl?: string;
  readonly whiteBgUrl?: string;
  readonly localFilePath?: string;
}

/**
 * Thông số ảnh phối cảnh phòng (lifestyle mockup) do AI render.
 */
export interface PodComposedMockupSpec {
  readonly referenceImageId?: string;
  readonly mockupUrl: string;
  readonly localFilePath?: string;
  readonly detectedSceneType?: string;
  readonly detectedSceneDescription?: string;
}

/**
 * Cấu trúc thành phẩm của một mẫu thiết kế từ Pinterest POD bàn giao sang SEO.
 */
export interface PodDeliverableItem {
  readonly designId: string;
  readonly sourceCandidateId?: string;
  readonly productType?: "rug" | "blanket" | "custom" | string;
  readonly originalPinTitle: string;
  readonly trendKeywords?: readonly string[];
  readonly printMaster?: PodPrintMasterSpec;
  readonly cutoutProduct?: PodCutoutSpec;
  readonly composedMockups?: readonly PodComposedMockupSpec[];
}

/**
 * Gói dữ liệu hoàn chỉnh bàn giao từ Pinterest POD sang SEO (theo CONTRACT_PINTEREST_POD_TO_SEO.md).
 */
export interface PinterestPodDeliverables {
  readonly workflowId: string;
  readonly success: boolean;
  readonly productType?: "rug" | "blanket" | "custom" | string;
  readonly totalProduced?: number;
  readonly items: readonly PodDeliverableItem[];
}

/**
 * Tùy chọn thực thi bộ điều phối SEO cho các thành phẩm Pinterest POD.
 */
export interface PinterestPodAdapterOptions {
  /** Runner tùy chỉnh (hỗ trợ dependency injection hoặc testing) */
  readonly runner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
  /** Số lượng sản phẩm xử lý đồng thời tối đa (mặc định: 1, tối đa: 3) */
  readonly concurrency?: number;
  /** Niche mặc định khi sản phẩm không suy luận được niche (mặc định: "Home Decor") */
  readonly defaultNiche?: string;
  /** Callback phát sự kiện ngay khi một sản phẩm hoàn tất xử lý */
  readonly onItemCompleted?: (itemResult: PinterestPodSeoItemResult) => void;
  /** Callback phát sự kiện ngay khi một sản phẩm xử lý thất bại */
  readonly onItemFailed?: (itemResult: PinterestPodSeoItemResult) => void;
  /** Callback phát sự kiện tiến độ tổng thể của batch */
  readonly onProgress?: (stats: SeoQueueProgressStats) => void;
}

/**
 * Alias tương thích ngược cho PinterestPodAdapterOptions.
 */
export type PinterestPodSeoOptions = PinterestPodAdapterOptions;

/**
 * Kết quả xử lý SEO cho từng mẫu thiết kế / sản phẩm riêng lẻ của Pinterest POD.
 */
export interface PinterestPodSeoItemResult {
  readonly designId: string;
  readonly sourceCandidateId?: string;
  readonly productType: string;
  readonly handle?: string;
  readonly deliverableItem?: PodDeliverableItem;
  readonly sourceItem: PodDeliverableItem;
  readonly seoInput: SeoContentInput;
  readonly seoOutput?: SeoContentOutput;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Kết quả xử lý tổng hợp theo lô (batch) từ Pinterest POD qua Pipeline SEO.
 */
export interface PinterestPodSeoBatchResult {
  readonly workflowId?: string;
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  readonly items: readonly PinterestPodSeoItemResult[];
  readonly seoOutputs: readonly SeoContentOutput[];
}

/**
 * Chuyển đổi text thô thành URL slug chuẩn SEO.
 */
function slugify(text: string, maxLength = 60): string {
  const normalized = text
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength).replace(/-+$/g, "");
}

function inferNiche(
  productType: string,
  trendKeywords?: readonly string[],
  defaultNiche = "Home Decor",
): string {
  const normType = (productType || "").toLowerCase();
  let baseCategory = defaultNiche;
  if (normType.includes("rug")) {
    baseCategory = "Home Decor > Rugs & Area Rugs";
  } else if (normType.includes("blanket")) {
    baseCategory = "Home & Living > Bedding & Blankets";
  } else if (normType.includes("custom")) {
    baseCategory = "Custom Print-on-Demand";
  }

  if (trendKeywords && trendKeywords.length > 0 && typeof trendKeywords[0] === "string" && trendKeywords[0].trim().length > 0) {
    return `${baseCategory} (${trendKeywords[0].trim()})`;
  }
  return baseCategory;
}

/**
 * Sinh nội dung mô tả gốc ban đầu dựa vào thông tin Pinterest POD bàn giao.
 * Kết hợp tiêu đề gốc, từ khóa trend, và mô tả không gian phòng do AI Vision nhận diện.
 */
function buildDescription(item: PodDeliverableItem): string {
  const sections: string[] = [];

  if (item.originalPinTitle && item.originalPinTitle.trim().length > 0) {
    sections.push(item.originalPinTitle.trim());
  }

  if (item.trendKeywords && item.trendKeywords.length > 0) {
    const validTrends = item.trendKeywords
      .map((k) => (typeof k === "string" ? k.trim() : ""))
      .filter((k) => k.length > 0);
    if (validTrends.length > 0) {
      sections.push(`Trending Aesthetic & Search Keywords: ${validTrends.join(", ")}.`);
    }
  }

  if (item.composedMockups && item.composedMockups.length > 0) {
    const sceneNotes = item.composedMockups
      .map((m) => {
        const scene = m.detectedSceneType?.trim();
        const desc = m.detectedSceneDescription?.trim();
        if (scene && desc) {
          return `${scene} setting (${desc})`;
        }
        return desc || scene || "";
      })
      .filter((s) => s.length > 0);

    if (sceneNotes.length > 0) {
      sections.push(`Lifestyle Room Context: ${sceneNotes.join("; ")}.`);
    }
  }

  return sections.join("\n\n") || item.originalPinTitle || "Print-on-demand custom product.";
}

/**
 * Trích xuất và chuẩn hóa danh sách hình ảnh từ PodDeliverableItem sang SeoContentImageInput.
 * Ưu tiên ảnh phôi nền trắng (whiteBgUrl) làm ảnh đại diện chính (featured image),
 * theo sau là các ảnh phối cảnh AI phòng (mockupUrl) và file thiết kế in (rgbUrl).
 */
function extractImages(item: PodDeliverableItem): SeoContentImageInput[] {
  const images: SeoContentImageInput[] = [];
  const seenUrls = new Set<string>();

  const addImage = (url: string | undefined, alt: string | undefined, localFilePath?: string): void => {
    if (!url || typeof url !== "string") return;
    const cleanUrl = url.trim();
    if (cleanUrl.length === 0 || seenUrls.has(cleanUrl)) return;
    seenUrls.add(cleanUrl);
    images.push({
      url: cleanUrl,
      ...(alt ? { alt: alt.trim() } : {}),
      ...(localFilePath && typeof localFilePath === "string" && localFilePath.trim().length > 0
        ? { localFilePath: localFilePath.trim() }
        : {}),
    });
  };

  const title = item.originalPinTitle || item.designId;

  // 1. Ảnh quảng bá Storefront: CHỈ lấy các ảnh phối cảnh AI Mockup (AI_background) do AI render
  const hasMockups = Array.isArray(item.composedMockups) && item.composedMockups.some((m) => Boolean(m?.mockupUrl));
  if (hasMockups && Array.isArray(item.composedMockups)) {
    for (const mockup of item.composedMockups) {
      if (!mockup?.mockupUrl) continue;
      const scene = mockup.detectedSceneType || "living room";
      const desc = mockup.detectedSceneDescription || "";
      const alt = desc ? `${title} styled in ${scene}: ${desc}` : `${title} in ${scene} setting`;
      addImage(mockup.mockupUrl, alt, mockup.localFilePath);
    }
  } else if (item.cutoutProduct?.whiteBgUrl) {
    // Dự phòng an toàn: nếu chưa có mockup AI nào, lấy tạm ảnh phôi trắng để không bị trống ảnh sản phẩm
    addImage(
      item.cutoutProduct.whiteBgUrl,
      `${title} - Clean White Background Product View`,
      item.cutoutProduct.localFilePath,
    );
  }

  // Chú ý: Ảnh bản in (item.printMaster) được lưu độc quyền vào Shopify Metafields,
  // tuyệt đối không đưa vào mảng images của storefront để tránh lộ file xưởng và tránh lỗi dung lượng 20MB.

  return images;
}

/**
 * Chuyển đổi một sản phẩm PodDeliverableItem sang chuẩn `SeoContentInput`.
 *
 * @param item Thành phẩm chi tiết từ module Pinterest POD.
 * @param defaultNiche Ngành hàng dự phòng nếu không suy luận được.
 * @returns Đối tượng `SeoContentInput` chuẩn cho pipeline SEO.
 */
export function fromPinterestPodItem(
  item: PodDeliverableItem,
  defaultNiche = "Home Decor",
): SeoContentInput {
  const designId = (typeof item.designId === "string" ? item.designId : "").trim();
  const rawTitle = typeof item.originalPinTitle === "string" && item.originalPinTitle.trim().length > 0
    ? item.originalPinTitle.trim()
    : designId || "Untitled Pinterest POD Item";

  const handle = slugify(rawTitle) || slugify(designId) || "pinterest-pod-product";
  const niche = inferNiche(item.productType || "", item.trendKeywords, defaultNiche);
  const description = buildDescription(item);
  const images = extractImages(item);

  return {
    productId: designId || item.sourceCandidateId,
    title: rawTitle,
    description,
    niche,
    handle,
    images,
  };
}

/**
 * Chuyển đổi toàn bộ gói thành phẩm Pinterest POD sang danh sách `SeoContentInput`.
 *
 * @param deliverables Gói thành phẩm bàn giao từ Pinterest POD.
 * @param defaultNiche Ngành hàng mặc định dự phòng.
 * @returns Mảng `SeoContentInput[]` chuẩn hóa.
 */
export function fromPinterestPodBatch(
  deliverables: PinterestPodDeliverables,
  defaultNiche = "Home Decor",
): readonly SeoContentInput[] {
  if (!deliverables || !Array.isArray(deliverables.items)) {
    return [];
  }
  return deliverables.items.map((it) => fromPinterestPodItem(it, defaultNiche));
}

/**
 * Runner chính của Adapter (Pinterest POD -> SEO Content Pipeline):
 * Nhận gói bàn giao từ Pinterest POD, tự động chuyển đổi và thực thi Pipeline SEO B1 → B6,
 * trả về kết quả batch tổng hợp đầy đủ và danh sách `seoOutputs` chuẩn hóa.
 *
 * @param deliverables Gói thành phẩm từ Pinterest POD (hoặc mảng items).
 * @param options Tùy chọn runner, concurrency, default niche.
 * @returns Kết quả batch tổng hợp kèm danh sách JSON `seoOutputs`.
 */
export async function runPinterestPodSeoPipeline(
  deliverables: PinterestPodDeliverables | readonly PodDeliverableItem[],
  options: PinterestPodAdapterOptions = {},
): Promise<PinterestPodSeoBatchResult> {
  const rawItems: readonly PodDeliverableItem[] = Array.isArray(deliverables)
    ? deliverables
    : deliverables && "items" in deliverables && Array.isArray(deliverables.items)
      ? deliverables.items
      : [];
  const workflowId = !Array.isArray(deliverables) && deliverables && "workflowId" in deliverables
    ? deliverables.workflowId
    : "unknown_workflow";

  if (rawItems.length === 0) {
    return {
      workflowId,
      total: 0,
      successful: 0,
      failed: 0,
      items: [],
      seoOutputs: [],
    };
  }

  const baseRunner = options.runner || runSeoContent;
  const rawConcurrency = typeof options.concurrency === "number" && !Number.isNaN(options.concurrency)
    ? options.concurrency
    : 1;
  const concurrency = Math.max(1, Math.min(Math.floor(rawConcurrency), 3));

  interface IndexedItem {
    readonly index: number;
    readonly result: PinterestPodSeoItemResult;
    readonly seoOutput?: SeoContentOutput;
  }
  const collectedItems: IndexedItem[] = [];

  const queue = createSeoContentQueue<PodDeliverableItem>({
    concurrency,
    runner: async (seoInput) => baseRunner(seoInput),
    onItemCompleted: (item, seoOutput) => {
      const deliverableItem = item.source as PodDeliverableItem;
      const itemResult: PinterestPodSeoItemResult = {
        designId: deliverableItem.designId || "",
        sourceCandidateId: deliverableItem.sourceCandidateId,
        productType: deliverableItem.productType || "custom",
        handle: item.seoInput.handle,
        deliverableItem,
        sourceItem: deliverableItem,
        seoInput: item.seoInput,
        seoOutput,
        success: true,
      };
      collectedItems.push({ index: item.index, result: itemResult, seoOutput });
      options.onItemCompleted?.(itemResult);
    },
    onItemFailed: (item, error) => {
      const deliverableItem = item.source as PodDeliverableItem;
      const itemResult: PinterestPodSeoItemResult = {
        designId: deliverableItem.designId || "",
        sourceCandidateId: deliverableItem.sourceCandidateId,
        productType: deliverableItem.productType || "custom",
        handle: item.seoInput.handle,
        deliverableItem,
        sourceItem: deliverableItem,
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

  const inputs = rawItems.map((it) => fromPinterestPodItem(it, options.defaultNiche));
  queue.enqueue(inputs, rawItems);
  await queue.waitForDrain();

  collectedItems.sort((a, b) => a.index - b.index);
  const items = collectedItems.map((entry) => entry.result);
  const orderedOutputs = collectedItems
    .filter((entry): entry is IndexedItem & { seoOutput: SeoContentOutput } => entry.result.success && Boolean(entry.seoOutput))
    .map((entry) => entry.seoOutput);

  const successful = items.filter((it) => it.success).length;
  const failed = items.length - successful;

  return {
    workflowId,
    total: items.length,
    successful,
    failed,
    items,
    seoOutputs: orderedOutputs,
  };
}
