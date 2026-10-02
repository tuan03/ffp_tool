export interface ShopifyProductImage {
  readonly id?: string;
  readonly url: string;
  readonly altText?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
}

export interface ShopifyProductVariant {
  readonly id: string;
  readonly productId?: string;
  readonly title: string;
  readonly price?: string;
  readonly compareAtPrice?: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly inventoryQuantity?: number;
}

export interface ShopifyProductCollectionSummary {
  readonly id: string;
  readonly title: string;
  readonly handle?: string;
}

export interface ShopifyProductForAutoSeoUi {
  readonly id: string;
  readonly storeId?: string;
  readonly title: string;
  readonly handle: string;
  readonly description?: string;
  readonly descriptionHtml?: string;
  readonly status?: "ACTIVE" | "ARCHIVED" | "DRAFT" | string;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly collections?: readonly ShopifyProductCollectionSummary[];
  readonly onlineStoreUrl?: string;
  readonly featuredImage?: ShopifyProductImage;
  readonly images?: readonly ShopifyProductImage[];
  readonly variants?: readonly ShopifyProductVariant[];
  readonly seo?: {
    readonly title?: string | null;
    readonly description?: string | null;
  };
  readonly hasMoreVariants?: boolean;
  readonly hasMoreImages?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly seoVersion?: number;
}

export type ProductReviewDecision =
  | "pending"
  | "approved"
  | "needs_edit"
  | "mark_draft"
  | "skipped";

export type ShopifyStatusFilter =
  | "all"
  | "ACTIVE"
  | "DRAFT"
  | "ARCHIVED";

export type SeoVersionFilter =
  | "all"
  | "v0"
  | "v1"
  | "v2"
  | "v3_plus"
  | "v_any";

export function extractProductSeoVersion(tags?: readonly string[] | string | null): number | undefined {
  if (!tags) return undefined;
  const tagList = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",").map((t) => t.trim()) : [];
  for (const tag of tagList) {
    const match = /^seo-v(\d+)$/i.exec(tag.trim());
    if (match) {
      const v = parseInt(match[1], 10);
      if (!Number.isNaN(v)) return v;
    }
  }
  return undefined;
}

export interface AutoSeoProductImage {
  readonly url?: string;
  readonly path?: string;
  readonly altText?: string;
  readonly position?: number;
}

export interface AutoSeoProductCandidate {
  readonly productId: string;
  readonly handle: string;
  readonly title: string;
  readonly descriptionHtml: string;
  readonly seoTitle?: string | null;
  readonly seoDescription?: string | null;
  readonly images: readonly AutoSeoProductImage[];
}

export interface AutoSeoSelectionInput {
  readonly workflowId: string;
  readonly products: readonly AutoSeoProductCandidate[];
  readonly selectedProductIds?: readonly string[];
  readonly selectedHandles?: readonly string[];
}

export interface SeoContentInputPayload {
  readonly productId: string;
  readonly handle: string;
  readonly sourceTitle: string;
  readonly sourceDescriptionHtml: string;
  readonly sourceSeoTitle?: string | null;
  readonly sourceSeoDescription?: string | null;
  readonly images: readonly AutoSeoProductImage[];
}

export interface AutoSeoOutput {
  readonly workflowId: string;
  readonly selectedCount: number;
  readonly seoContentInputs: readonly SeoContentInputPayload[];
  readonly warnings: readonly string[];
}

export interface AutoSeoBackupRequest {
  readonly workflowId: string;
  readonly storeId: string;
  readonly shopDomain: string;
  readonly products: readonly ShopifyProductForAutoSeoUi[];
}

export interface AutoSeoBackupResponse {
  readonly seoProvider?: "gemini" | "custom_gpt" | "codex_mcp";
  readonly workflowId: string;
  readonly backedUpCount: number;
  readonly backupIds: readonly string[];
  readonly downstreamStatus: "SENT" | "FAILED";
  readonly downstreamHttpStatus?: number | null;
  readonly downstreamError?: string | null;
  /** Number of generated SEO outputs durably handed off to SEO Review by the server. */
  readonly reviewPersistedCount?: number;
  readonly acceptedProductIds?: readonly string[];
  readonly acceptedCount?: number;
  readonly skippedProducts?: readonly AutoSeoSkippedProduct[];
  readonly skippedCount?: number;
  readonly seoDispatch?:
    | {
        readonly provider: "gemini";
        readonly status: "review_ready";
        readonly reviewPersistedCount: number;
      }
    | {
        readonly provider: "custom_gpt" | "codex_mcp";
        readonly status: "queued";
        readonly jobIds: readonly string[];
      };
}

export interface AutoSeoSkippedProduct {
  readonly productId: string;
  readonly reason: "UNCHANGED" | "ACTIVE_DUPLICATE";
}

export type AutoSeoEligibilityState =
  | "never_processed"
  | "changed"
  | "current"
  | "active"
  | "retry";

export type AutoSeoEligibilityReason =
  | "NO_HISTORY"
  | "LAST_DISPATCH_FAILED"
  | "SHOPIFY_UPDATED"
  | "UP_TO_DATE"
  | "HASH_VERIFICATION_REQUIRED"
  | "SOURCE_TIMESTAMP_UNKNOWN"
  | "BASELINE_TIMESTAMP_UNKNOWN"
  | "ACTIVE_DISPATCH"
  | "ACTIVE_QUEUE"
  | "ACTIVE_REVIEW";

export interface AutoSeoEligibilityProductSummary {
  readonly productId: string;
  readonly updatedAt?: string;
}

export interface AutoSeoEligibilityRequest {
  readonly storeId: string;
  readonly products: readonly AutoSeoEligibilityProductSummary[];
}

export interface AutoSeoEligibilityItem {
  readonly productId: string;
  readonly state: AutoSeoEligibilityState;
  readonly reason: AutoSeoEligibilityReason;
  readonly lastSuccessfulShopifyUpdatedAt?: string;
}

export interface AutoSeoEligibilityResponse {
  readonly items: readonly AutoSeoEligibilityItem[];
  readonly counts: Readonly<Record<AutoSeoEligibilityState, number>>;
}

export interface AutoSeoStoreOption {
  readonly storeId: string;
  readonly shopDomain: string;
}

export interface AutoSeoCollectionOption {
  readonly id: string;
  readonly title: string;
  readonly handle?: string;
  readonly productsCount?: number;
}

export interface AutoSeoClient {
  listStores?(): Promise<readonly AutoSeoStoreOption[]>;
  listCollections?(storeId?: string): Promise<readonly AutoSeoCollectionOption[]>;
  setActiveStoreId?(storeId: string): void;
  getActiveStoreId?(): string | undefined;
  getStoreInfo(storeId?: string): Promise<{
    storeId: string;
    shopDomain: string;
  }>;
  loadProducts(storeId?: string): Promise<readonly ShopifyProductForAutoSeoUi[]>;
  loadProductDetail(productId: string): Promise<ShopifyProductForAutoSeoUi>;
  loadProductDetail(storeId: string, productId: string): Promise<ShopifyProductForAutoSeoUi>;
  loadProductDetailFresh?(productId: string): Promise<ShopifyProductForAutoSeoUi>;
  loadProductDetailFresh?(storeId: string, productId: string): Promise<ShopifyProductForAutoSeoUi>;
  runAutoSeo(input: AutoSeoSelectionInput): Promise<AutoSeoOutput>;
  getProductEligibility?(request: AutoSeoEligibilityRequest): Promise<AutoSeoEligibilityResponse>;
  runAutoSeoBackup(request: AutoSeoBackupRequest): Promise<AutoSeoBackupResponse>;
  hydrateSelectedProductsFresh(
    productIds: readonly string[],
    concurrency?: number,
    storeId?: string,
  ): Promise<readonly ShopifyProductForAutoSeoUi[]>;
  hydrateSelectedProducts?(
    productIds: readonly string[],
    concurrency?: number,
    storeId?: string,
  ): Promise<readonly ShopifyProductForAutoSeoUi[]>;
  getCachedDetail?(productId: string, storeId?: string): ShopifyProductForAutoSeoUi | undefined;
  clearCache?(): void;
  clearDetailCache?(): void;
}

export type AutoSeoHandoverHandler = (
  products: readonly ShopifyProductForAutoSeoUi[],
  storeId?: string,
) => Promise<void>;
