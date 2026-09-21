export interface ShopifyProductImage {
  readonly id?: string;
  readonly url: string;
  readonly altText?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
}

export interface ShopifyProductVariant {
  readonly id: string;
  readonly title: string;
  readonly price?: string;
  readonly sku?: string;
  readonly inventoryQuantity?: number;
}

export interface ShopifyProductForAutoSeoUi {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly descriptionHtml?: string;
  readonly status?: string;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly featuredImage?: ShopifyProductImage;
  readonly images?: readonly ShopifyProductImage[];
  readonly variants?: readonly ShopifyProductVariant[];
  readonly seo?: {
    readonly title?: string | null;
    readonly description?: string | null;
  };
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

export interface AutoSeoClient {
  loadProducts(): Promise<readonly ShopifyProductForAutoSeoUi[]>;
  loadProductDetail(productId: string): Promise<ShopifyProductForAutoSeoUi>;
  loadProductDetail(storeId: string, productId: string): Promise<ShopifyProductForAutoSeoUi>;
  runAutoSeo(input: AutoSeoSelectionInput): Promise<AutoSeoOutput>;
  hydrateSelectedProducts?(
    productIds: readonly string[],
    concurrency?: number,
  ): Promise<readonly ShopifyProductForAutoSeoUi[]>;
  getCachedDetail?(productId: string): ShopifyProductForAutoSeoUi | undefined;
  clearCache?(): void;
  clearDetailCache?(): void;
}
