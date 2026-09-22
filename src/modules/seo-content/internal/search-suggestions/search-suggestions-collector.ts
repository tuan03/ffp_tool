import type {
  ProductUnderstanding,
  SearchResearchResult,
  ShoppingContext,
} from "../domain-types";

export interface SearchSuggestionsCollectorInput {
  readonly source: {
    readonly niche?: string;
    readonly title?: string;
    readonly description?: string;
    readonly handle?: string;
  };
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
}

export interface SearchSuggestionsCollector {
  collect(
    input: SearchSuggestionsCollectorInput,
  ): Promise<SearchResearchResult>;
}
