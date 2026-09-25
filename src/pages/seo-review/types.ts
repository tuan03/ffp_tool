/**
 * Types and ViewModels for the MAIN SEO Content Review UI.
 *
 * Enforces strict separation between raw SEO Content Output and UI display models.
 * Tracks data provenance ("real" vs "mock") per field to ensure transparent reviews.
 */

import type { CrawlProduct } from "../../modules/customization-normalizer";
import type { AmazonCrawlerReviewTarget } from "../../modules/amazon-crawler";
import type { PodDeliverableItem } from "../../modules/pinterest-pod";

export type FieldSource = "real" | "mock";

export type SeoProcessingStatus = "processing" | "completed" | "failed";

export type ReviewDecision = "pending" | "approved" | "rejected";

export type SeoReviewViewMode = "cards" | "table" | "split";

export type ShopifySyncStatus = "idle" | "queued" | "syncing" | "synced" | "failed";

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

export interface SeoProductBackup {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly handle?: string;
  readonly seoTitle?: string;
  readonly seoDescription?: string;
  readonly backedUpAt?: number;
}

export interface SeoProductUiViewModel {
  readonly id: string;
  readonly storeId?: string;
  readonly productId?: string;
  readonly asin?: string;
  readonly sourceNiche?: string;
  readonly coordinatorReview?: {
    readonly itemId: string;
    readonly jobId: string;
    readonly version: number;
    readonly target: AmazonCrawlerReviewTarget;
  };

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

  // Crawl source product (if originated from Amazon Crawler)
  readonly sourceCrawlProduct?: CrawlProduct;

  // Pinterest POD source item (if originated from Pinterest POD Studio)
  readonly sourcePinterestItem?: PodDeliverableItem;

  // Shopify Store Sync State
  readonly shopifySyncStatus?: ShopifySyncStatus;
  readonly shopifyAdminUrl?: string;
  readonly shopifySyncError?: string;
  readonly shopifySyncedAt?: number;

  // Syncing State (Cách 1: Sync ngay khi duyệt)
  readonly isSyncing?: boolean;
  readonly syncError?: string;
  readonly lastSyncedAt?: number;

  // Rollback / Undo State
  readonly isReverting?: boolean;
  readonly revertError?: string;
  readonly lastRevertedAt?: number;
  readonly originalBackup?: SeoProductBackup;
}

export interface SeoReviewFilterState {
  readonly searchQuery: string;
  readonly statusFilter: "all" | SeoProcessingStatus;
  readonly decisionFilter: "all" | ReviewDecision | "sync_failed";
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

export interface ZoomImageItem {
  readonly url: string;
  readonly altText?: string;
  readonly title?: string;
}
