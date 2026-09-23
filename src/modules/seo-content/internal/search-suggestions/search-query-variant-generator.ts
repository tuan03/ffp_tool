import type { ProductUnderstanding, ShoppingContext } from "../domain-types";
import type { SearchSeed } from "./search-seed-selector";

export interface SearchQueryVariantGroup {
  readonly seedQuery: string;
  readonly variants: readonly string[];
}

export interface SearchQueryVariantGeneratorInput {
  readonly seeds: readonly SearchSeed[];
  readonly source: {
    readonly niche?: string;
    readonly title?: string;
    readonly description?: string;
    readonly handle?: string;
  };
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
}

export interface SearchQueryVariantGenerator {
  generate(
    input: SearchQueryVariantGeneratorInput,
  ): Promise<readonly SearchQueryVariantGroup[]>;
}

/** Safe offline/default fallback: do not invent autocomplete probes. */
export class NoopSearchQueryVariantGenerator
  implements SearchQueryVariantGenerator
{
  async generate(): Promise<readonly SearchQueryVariantGroup[]> {
    return [];
  }
}
