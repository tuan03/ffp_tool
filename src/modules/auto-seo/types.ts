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
