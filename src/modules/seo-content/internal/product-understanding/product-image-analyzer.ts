import type { SeoContentImageInput } from "../../types";

export interface ProductImageAnalyzerInput {
  readonly image: SeoContentImageInput;
  readonly title: string;
  readonly description: string;
  readonly niche: string;
}

export interface ProductImageAnalysis {
  readonly ocrTexts: readonly string[];
  readonly detectedEntities: readonly string[];
  readonly dominantColors: readonly string[];
  readonly visualStyle?: string;
  readonly productCategory?: string;
}

export interface ProductImageAnalyzer {
  analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis>;
}
