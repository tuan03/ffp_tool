import type {
  ProductImageAnalysis,
  ProductImageAnalyzer,
  ProductImageAnalyzerInput,
} from "./product-image-analyzer";
import { extractTextProductSignals } from "./text-product-signals";

export class HeuristicProductImageAnalyzer implements ProductImageAnalyzer {
  async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
    const altText = input.image.alt?.trim() ?? "";
    const rawTarget = input.image.localFilePath || input.image.url || "";
    const cleanTarget = rawTarget.split(/[?#]/)[0] ?? "";
    const filename = cleanTarget.split(/[\\/]/).pop() ?? "";

    // 1. OCR text extraction:
    // Heuristic analyzer does not inspect image pixels; alt is metadata and must not be promoted to OCR.
    const ocrTexts: readonly string[] = [];

    // 2. Extract signals from alt text and filename
    const altSignals = extractTextProductSignals({
      title: altText,
      description: filename.replace(/[-_]/g, " "),
      niche: input.niche,
    });

    // 3. Fallback to title/description signals if alt was empty
    const contextSignals = extractTextProductSignals({
      title: input.title,
      description: input.description,
      niche: input.niche,
    });

    const detectedEntities = altSignals.detectedEntities.length > 0
      ? altSignals.detectedEntities
      : contextSignals.detectedEntities;

    const dominantColors = altSignals.dominantColors.length > 0
      ? altSignals.dominantColors
      : contextSignals.dominantColors;

    const visualStyle = altSignals.visualStyle ?? contextSignals.visualStyle;
    const productCategory = altSignals.productCategory ?? contextSignals.productCategory;

    return {
      ocrTexts,
      detectedEntities,
      dominantColors,
      visualStyle,
      productCategory,
    };
  }
}

export const heuristicProductImageAnalyzer = new HeuristicProductImageAnalyzer();
