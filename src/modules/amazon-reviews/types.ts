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
  clear(jobId: string): Promise<void>;
  generate(input: { readonly contextJobId: string; readonly storeId: string; readonly count: number; readonly requestId: string }): Promise<ReviewGenerationJob>;
  latestGeneration(contextJobId: string, storeId: string): Promise<ReviewGenerationJob | null>;
  cancelGeneration(id: string): Promise<ReviewGenerationJob>;
  retryGenerationSave(id: string): Promise<ReviewGenerationJob>;
  saveSamples(jobId: string, samples: readonly AmazonReview[]): Promise<void>;
  export(jobId: string, input: { readonly kind: "real" | "ai" | "preview"; readonly reviewIds: readonly string[]; readonly products: readonly ReviewProduct[]; readonly extraPictureUrls: readonly string[]; readonly randomizeReviewCount: boolean; readonly minReviewsPerProduct: number }): Promise<Blob>;
}

export interface ReviewGenerationJob {
  readonly phase?: "waiting_response" | "reading_response" | "sending_response";
  readonly id: string;
  readonly contextJobId: string;
  readonly storeId: string;
  readonly count: number;
  readonly status: "queued" | "running" | "validating" | "saving" | "save_failed" | "completed" | "partial" | "failed" | "cancelled" | "interrupted";
  readonly createdAt: string;
  readonly accepted: number;
  readonly rejected: number;
  readonly warnings: readonly string[];
  readonly error?: string;
}
