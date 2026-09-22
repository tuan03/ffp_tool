/**
 * Types and ViewModels for the MAIN SEO Content Review UI.
 *
 * Enforces strict separation between raw SEO Content Output and UI display models.
 * Tracks data provenance ("real" vs "mock") per field to ensure transparent reviews.
 */

export type FieldSource = "real" | "mock";

export type SeoProcessingStatus = "processing" | "completed" | "failed";

export type ReviewDecision = "pending" | "approved" | "rejected";

export interface DisplayField<T> {
  readonly value: T;
  readonly source: FieldSource;
}

export interface SeoImageUiViewModel {
  readonly id: string;
  readonly previewUrl: DisplayField<string>;
  readonly alt: DisplayField<string>;
  readonly webpUrl: DisplayField<string>;
  readonly webpFilename: DisplayField<string>;
}

export interface SeoProductUiViewModel {
  readonly id: string;
  readonly productId?: string;
  readonly asin?: string;
  readonly sourceNiche?: string;

  // Core Display Fields
  readonly productTitle: DisplayField<string>;
  readonly productDescription: DisplayField<string>;
  readonly seoTitle: DisplayField<string>;
  readonly seoDescription: DisplayField<string>;
  readonly handle: DisplayField<string>;
  readonly images: readonly SeoImageUiViewModel[];

  // Progress & Review State
  readonly seoStatus: DisplayField<SeoProcessingStatus>;
  readonly reviewDecision: ReviewDecision;
  readonly rejectionReason?: string;
  readonly updatedAt: number;
}

export interface SeoReviewFilterState {
  readonly searchQuery: string;
  readonly statusFilter: "all" | SeoProcessingStatus;
  readonly decisionFilter: "all" | ReviewDecision;
  readonly onlyMockData: boolean;
}

export interface SeoProductEditInput {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly handle: string;
  readonly imageAlts: readonly { readonly id: string; readonly alt: string }[];
}
