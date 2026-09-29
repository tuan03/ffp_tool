export interface AmazonReview {
  readonly reviewId: string;
  readonly author: string;
  readonly rating: number;
  readonly title?: string;
  readonly body: string;
  readonly dateText?: string;
  readonly variantText?: string;
  readonly verifiedPurchase: boolean;
  readonly images?: readonly string[];
  readonly permalink?: string;
  readonly synthetic: boolean;
  readonly source: "amazon" | "ai_sample";
  readonly promptVersion?: string;
  readonly qualityStatus?: string;
  readonly qualityWarnings?: readonly string[];
}

export interface AmazonReviewContext {
  readonly asin: string;
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  readonly bullets?: readonly string[];
  readonly details?: Readonly<Record<string, string>>;
}

export interface AmazonReviewJob {
  readonly jobId: string;
  readonly status: string;
  readonly asin: string;
  readonly sourceUrl: string;
  readonly progress?: { readonly phase?: string; readonly message?: string; readonly completed?: number; readonly total?: number };
  readonly error?: { readonly message?: string } | null;
  readonly reviewData: {
    readonly context?: AmazonReviewContext;
    readonly reviews?: readonly AmazonReview[];
    readonly reviewCount?: number;
    readonly pagesFetched?: number;
    readonly stopReason?: string;
    readonly warnings?: readonly string[];
  };
  readonly samples: readonly AmazonReview[];
}

export interface ReviewProduct {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly status: string;
}

export interface ProductLookupPage {
  readonly products: readonly ReviewProduct[];
  readonly nextCursor?: string;
}

export interface ReviewShopifyAccess {
  listStores(): Promise<readonly string[]>;
  findProducts(storeId: string, query: string, cursor?: string): Promise<ProductLookupPage>;
}

export interface ReviewClient {
  create(source: string, maxPages?: number): Promise<{ readonly jobId: string }>;
  get(jobId: string): Promise<AmazonReviewJob>;
  generate(input: { readonly asin: string; readonly count: number; readonly startIndex: number; readonly product: AmazonReviewContext; readonly sourceReviews: readonly AmazonReview[]; readonly priorSamples: readonly AmazonReview[] }): Promise<{ readonly samples: readonly AmazonReview[]; readonly rejected: number; readonly warnings: readonly string[] }>;
  saveSamples(jobId: string, samples: readonly AmazonReview[]): Promise<void>;
  export(jobId: string, input: { readonly kind: "real" | "ai" | "preview"; readonly reviewIds: readonly string[]; readonly products: readonly ReviewProduct[]; readonly extraPictureUrls: readonly string[]; readonly randomizeReviewCount: boolean; readonly minReviewsPerProduct: number }): Promise<Blob>;
}
