import type { SeoContentImageInput } from "../../types";

export interface ProductImageAnalyzerInput {
  readonly images: readonly SeoContentImageInput[];
  readonly title: string;
  readonly description: string;
  readonly niche: string;
}

export interface ProductImageAnalysis {
  readonly typography: {
    readonly visibleTexts: readonly string[];
    readonly styleSummary: string;
  };
  readonly visualEntities: string;
  readonly sceneContext: string;
  readonly physicalProductIdentity: string;
}

export interface ProductImageAnalyzer {
  analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis>;
}
