export interface ShopifyProductImage {
  readonly id?: string;
  readonly url: string;
  readonly altText?: string;
  readonly width?: number;
  readonly height?: number;
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
  readonly images?: readonly ShopifyProductImage[];
  readonly variants?: readonly ShopifyProductVariant[];
}

export interface AutoSeoProductImage {
  readonly url: string;
  readonly altText?: string;
  readonly position?: number;
}

export interface AutoSeoProductCandidate {
  readonly productId: string;
  readonly handle: string;
  readonly title: string;
  readonly descriptionHtml: string;
  readonly images: readonly AutoSeoProductImage[];
}

export type ProductReviewDecision =
  | "pending"
  | "approved"
  | "needs_edit"
  | "mark_draft"
  | "skipped";

export interface AutoSeoWorkflowInput {
  readonly workflowId: string;
  readonly niche: string;
  readonly products: readonly AutoSeoProductCandidate[];
  readonly selectedProductIds?: readonly string[];
}

export interface AutoSeoContentInput {
  readonly productId: string;
  readonly handle: string;
  readonly niche: string;
  readonly sourceTitle: string;
  readonly sourceDescriptionHtml: string;
  readonly images: readonly AutoSeoProductImage[];
}

export interface AutoSeoOutput {
  readonly workflowId: string;
  readonly selectedCount: number;
  readonly seoContentInputs: readonly AutoSeoContentInput[];
  readonly warnings: readonly string[];
}

export interface AutoSeoClient {
  loadProducts(): Promise<readonly ShopifyProductForAutoSeoUi[]>;
  runAutoSeo(input: AutoSeoWorkflowInput): Promise<AutoSeoOutput>;
}
