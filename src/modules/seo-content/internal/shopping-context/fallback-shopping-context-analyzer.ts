import type { ShoppingContext } from "../domain-types";
import type {
  ShoppingContextAnalysisInput,
  ShoppingContextAnalyzer,
} from "./shopping-context-analyzer";

export interface FallbackShoppingContextAnalyzerOptions {
  readonly primary: ShoppingContextAnalyzer;
  readonly fallback: ShoppingContextAnalyzer;
  readonly onFallback?: (
    error: unknown,
    input: ShoppingContextAnalysisInput,
  ) => void;
}

export class FallbackShoppingContextAnalyzer
  implements ShoppingContextAnalyzer
{
  private readonly primary: ShoppingContextAnalyzer;
  private readonly fallback: ShoppingContextAnalyzer;
  private readonly onFallback?: (
    error: unknown,
    input: ShoppingContextAnalysisInput,
  ) => void;

  constructor(options: FallbackShoppingContextAnalyzerOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback;
    this.onFallback = options.onFallback;
  }

  async analyze(input: ShoppingContextAnalysisInput): Promise<ShoppingContext> {
    try {
      return await this.primary.analyze(input);
    } catch (error) {
      if (this.onFallback) {
        try {
          this.onFallback(error, input);
        } catch {
          // Observability callback failure must not block the fallback execution
        }
      }
      return this.fallback.analyze(input);
    }
  }
}
