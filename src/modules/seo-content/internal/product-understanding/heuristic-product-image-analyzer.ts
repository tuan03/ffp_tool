import type {
  ProductImageAnalysis,
  ProductImageAnalyzer,
  ProductImageAnalyzerInput,
} from "./product-image-analyzer";
import { extractTextProductSignals } from "./text-product-signals";

export class HeuristicProductImageAnalyzer implements ProductImageAnalyzer {
  async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
    const contextSignals = extractTextProductSignals({
      title: input.title,
      description: input.description,
      niche: input.niche,
    });

    return {
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "unknown",
      sceneContext: "unknown",
      physicalProductIdentity: contextSignals.physicalProductIdentity ?? "unknown",
    };
  }
}

export const heuristicProductImageAnalyzer = new HeuristicProductImageAnalyzer();
