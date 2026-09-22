import { safeWordBoundaryRegex } from "./keyword-relevance-evaluator";

export interface BrandConflictEvaluation {
  readonly conflict: boolean;
  readonly brand?: string;
}

export interface BrandConflictPolicy {
  evaluate(keyword: string): BrandConflictEvaluation;
}

/**
 * Default no-op brand policy.
 * Does not emit brand_conflict unless an explicit brand registry policy is provided.
 */
export class NoopBrandConflictPolicy implements BrandConflictPolicy {
  evaluate(_keyword: string): BrandConflictEvaluation {
    return { conflict: false };
  }
}

/**
 * Configurable list-based brand conflict policy for unit tests or store configuration.
 */
export class ListBrandConflictPolicy implements BrandConflictPolicy {
  private readonly prohibitedBrands: readonly string[];

  constructor(prohibitedBrands: readonly string[]) {
    this.prohibitedBrands = prohibitedBrands.map((b) => b.trim().toLowerCase());
  }

  evaluate(keyword: string): BrandConflictEvaluation {
    const lower = keyword.toLowerCase();
    for (const brand of this.prohibitedBrands) {
      // Word-boundary check with regex escaping
      const regex = safeWordBoundaryRegex(brand);
      if (regex.test(lower)) {
        return { conflict: true, brand };
      }
    }
    return { conflict: false };
  }
}
