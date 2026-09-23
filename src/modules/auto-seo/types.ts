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

export interface ShopifyProductForAutoSeoUi {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly description?: string;
  readonly descriptionHtml?: string;
  readonly status?: "ACTIVE" | "ARCHIVED" | "DRAFT" | string;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
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
  readonly workflowId: string;
  readonly backedUpCount: number;
  readonly backupIds: readonly string[];
  readonly downstreamStatus: "SENT" | "FAILED";
  readonly downstreamHttpStatus?: number | null;
  readonly downstreamError?: string | null;
}

export interface AutoSeoStoreOption {
  readonly storeId: string;
  readonly shopDomain: string;
}

export interface AutoSeoClient {
  listStores?(): Promise<readonly AutoSeoStoreOption[]>;
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
) => Promise<void>;
