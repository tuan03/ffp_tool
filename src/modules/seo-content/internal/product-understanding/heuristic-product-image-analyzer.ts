import type {
  ProductImageAnalysis,
  ProductImageAnalyzer,
  ProductImageAnalyzerInput,
} from "./product-image-analyzer";

export class HeuristicProductImageAnalyzer implements ProductImageAnalyzer {
  async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
    return {
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "unknown",
      sceneContext: "unknown",
      physicalProductIdentity: "unknown",
      identityCandidates: [],
      excludedSceneEntities: [],
      confidence: 0,
      reviewRequired: true,
    };
  }
}

export const heuristicProductImageAnalyzer = new HeuristicProductImageAnalyzer();
