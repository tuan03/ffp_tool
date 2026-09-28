import type {
  ProductImageAnalysis,
  ProductImageAnalyzer,
  ProductImageAnalyzerInput,
} from "./product-image-analyzer";

export interface FallbackProductImageAnalyzerOptions {
  readonly primary: ProductImageAnalyzer;
  readonly fallback: ProductImageAnalyzer;
  readonly onFallback?: (error: unknown, input: ProductImageAnalyzerInput) => void;
}

/**
 * Decorator pattern that delegates analysis to a primary analyzer (e.g. Gemini),
 * falling back gracefully to a secondary analyzer (e.g. Heuristic) if primary fails.
 */
export class FallbackProductImageAnalyzer implements ProductImageAnalyzer {
  constructor(private readonly options: FallbackProductImageAnalyzerOptions) {}

  async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
    try {
      return await this.options.primary.analyze(input);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (this.options.onFallback) {
        this.options.onFallback(error, input);
      }
      return await this.options.fallback.analyze(input);
    }
  }
}
