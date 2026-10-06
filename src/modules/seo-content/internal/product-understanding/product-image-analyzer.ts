import type { SeoContentImageInput } from "../../types";

export interface ProductImageAnalyzerInput {
  readonly images: readonly SeoContentImageInput[];
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
  readonly identityCandidates?: readonly string[];
  readonly excludedSceneEntities?: readonly string[];
  readonly confidence?: number;
  readonly reviewRequired?: boolean;
}

export interface ProductImageAnalyzer {
  analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis>;
}
