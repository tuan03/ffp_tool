import type { ShoppingContext, ProductUnderstanding } from "../domain-types";

export interface ShoppingContextAnalysisInput {
  readonly source: {
    readonly niche: string;
    readonly title: string;
    readonly description: string;
    readonly handle: string;
  };
  readonly productUnderstanding?: ProductUnderstanding;
}

export interface ShoppingContextAnalyzer {
  analyze(input: ShoppingContextAnalysisInput): Promise<ShoppingContext>;
}
