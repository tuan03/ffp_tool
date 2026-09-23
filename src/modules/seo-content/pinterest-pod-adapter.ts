import type { PinterestPodDeliverables, PodDeliverableItem, PodProductType } from "../pinterest-pod";
import { runSeoContent } from "./service";
import type {
  SeoContentImageInput,
  SeoContentInput,
  SeoContentOutput,
} from "./types";

export interface PinterestPodSeoOptions {
  /** Custom runner for dependency injection / testing */
  readonly runner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
  /** Concurrency level (default: 3) */
  readonly concurrency?: number;
  /** Fallback niche if not identifiable from trendKeywords / productType */
  readonly defaultNiche?: string;
}

export interface PinterestPodSeoItemResult {
  readonly designId: string;
  readonly productType: PodProductType;
  readonly sourceItem: PodDeliverableItem;
  readonly seoInput: SeoContentInput;
  readonly seoOutput?: SeoContentOutput;
  readonly success: boolean;
  readonly error?: string;
}

export interface PinterestPodSeoBatchResult {
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  readonly items: readonly PinterestPodSeoItemResult[];
  readonly seoOutputs: readonly SeoContentOutput[];
}

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

/**
 * Converts a PodDeliverableItem from Pinterest POD Studio into SeoContentInput for SEO generation.
 */
export function fromPinterestPodItem(
  item: PodDeliverableItem,
  defaultNiche = "home decor",
): SeoContentInput {
  const title = (item.originalPinTitle || "").trim() || (item.productType === "blanket" ? "Cozy Throw Blanket" : "Custom Area Rug");

  // Determine Niche
  let niche = defaultNiche;
  if (item.trendKeywords && item.trendKeywords.length > 0) {
    const validKeywords = item.trendKeywords
      .map((k) => (typeof k === "string" ? k.trim() : ""))
      .filter((k) => k.length > 0);
    if (validKeywords.length > 0) {
      niche = validKeywords[0];
    }
  } else if (item.productType === "rug") {
    niche = "area rug";
  } else if (item.productType === "blanket") {
    niche = "throw blanket";
  }

  // Construct description context from POD attributes
  const descriptionParts: string[] = [];
  if (item.originalPinTitle) {
    descriptionParts.push(`Inspiration: ${item.originalPinTitle.trim()}`);
  }
  if (item.trendKeywords && item.trendKeywords.length > 0) {
    descriptionParts.push(`Trend tags: ${item.trendKeywords.filter(Boolean).join(", ")}`);
  }
  const typeLabel = item.productType === "blanket"
    ? "Ultra-soft plush fleece throw blanket with vibrant edge-to-edge printing."
    : "Premium area rug with non-slip backing, durable edge stitching, and vibrant colors.";
  descriptionParts.push(typeLabel);

  if (item.composedMockups && item.composedMockups.length > 0) {
    const roomHighlights = item.composedMockups
      .map((m) => {
        const scene = m.detectedSceneType ? `[${m.detectedSceneType}]` : "";
        const desc = m.detectedSceneDescription ? m.detectedSceneDescription.trim() : "";
        return scene && desc ? `${scene} ${desc}` : desc || scene;
      })
      .filter(Boolean);
    if (roomHighlights.length > 0) {
      descriptionParts.push(`Styling environments:\n${roomHighlights.map((r) => `• ${r}`).join("\n")}`);
    }
  }

  const description = descriptionParts.join("\n\n");
  const handle = slugify(title || item.designId);

  // Build image list:
  // 1. Featured image: white background cutout
  // 2. Composed mockups (room lifestyle settings)
  // 3. Transparent cutout
  // 4. Print master RGB
  const images: SeoContentImageInput[] = [];
  const seenUrls = new Set<string>();

  const addImage = (url?: string, alt?: string, localFilePath?: string) => {
    if (!url || typeof url !== "string") return;
    const trimmed = url.trim();
    if (!trimmed || seenUrls.has(trimmed)) return;
    seenUrls.add(trimmed);
    images.push({
      url: trimmed,
      alt: alt || title,
      localFilePath,
    });
  };

  if (item.cutoutProduct?.whiteBgUrl) {
    addImage(
      item.cutoutProduct.whiteBgUrl,
      `${title} - White Background Product View`,
      item.cutoutProduct.localFilePath,
    );
  }

  if (Array.isArray(item.composedMockups)) {
    item.composedMockups.forEach((mockup, idx) => {
      const scene = mockup.detectedSceneType ? `${mockup.detectedSceneType} setting` : "Room setting";
      const desc = mockup.detectedSceneDescription ? ` - ${mockup.detectedSceneDescription}` : "";
      addImage(
        mockup.mockupUrl,
        `${title} in ${scene}${desc} (Mockup ${idx + 1})`,
        mockup.localFilePath,
      );
    });
  }

  if (item.cutoutProduct?.transparentUrl) {
    addImage(
      item.cutoutProduct.transparentUrl,
      `${title} - Transparent Cutout`,
      item.cutoutProduct.localFilePath,
    );
  }

  if (item.printMaster?.rgbUrl) {
    addImage(
      item.printMaster.rgbUrl,
      `${title} - High Resolution 4K Design Artwork`,
      item.printMaster.localFilePath,
    );
  } else if (item.printMaster?.cmykUrl) {
    addImage(
      item.printMaster.cmykUrl,
      `${title} - 300 DPI Print Master`,
      item.printMaster.localFilePath,
    );
  }

  // Fallback if no images found
  if (images.length === 0) {
    addImage(
      "https://placehold.co/600x600/1e293b/94a3b8?text=Pinterest+POD+Product",
      `${title} - Preview`,
    );
  }

  return {
    title,
    niche,
    description,
    handle,
    productId: item.designId,
    images,
  };
}

/**
 * Main coordinator function to run the SEO Content pipeline for Pinterest POD deliverables.
 */
export async function runPinterestPodSeoPipeline(
  input: PinterestPodDeliverables | readonly PodDeliverableItem[],
  options: PinterestPodSeoOptions = {},
): Promise<PinterestPodSeoBatchResult> {
  const items: readonly PodDeliverableItem[] = Array.isArray(input)
    ? input
    : (input as PinterestPodDeliverables).items || [];

  const runner = options.runner || runSeoContent;
  const concurrency = Math.max(1, Math.min(options.concurrency || 3, 10));

  const results: PinterestPodSeoItemResult[] = [];
  const seoOutputs: SeoContentOutput[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (item): Promise<PinterestPodSeoItemResult> => {
      const seoInput = fromPinterestPodItem(item, options.defaultNiche);
      try {
        const seoOutput = await runner(seoInput);
        return {
          designId: item.designId,
          productType: item.productType,
          sourceItem: item,
          seoInput,
          seoOutput,
          success: true,
        };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          designId: item.designId,
          productType: item.productType,
          sourceItem: item,
          seoInput,
          success: false,
          error: errorMessage,
        };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    for (const res of chunkResults) {
      results.push(res);
      if (res.seoOutput) {
        seoOutputs.push(res.seoOutput);
      }
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.length - successful;

  return {
    total: results.length,
    successful,
    failed,
    items: results,
    seoOutputs,
  };
}
