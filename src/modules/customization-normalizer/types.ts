export interface ImageDimension {
  readonly width?: number | null;
  readonly height?: number | null;
}

export interface ImageResource {
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string;
  friendlyFileName?: string;
  dimension?: ImageDimension;
}

export interface CustomizationOptionPrice {
  readonly raw?: string;
  readonly amount?: number;
  readonly currency?: string;
}

export interface CustomizationOption {
  readonly id: string;
  readonly label: string;
  readonly price?: CustomizationOptionPrice;
  readonly cost?: number;
  readonly isAvailable?: boolean;
  readonly outOfStock?: boolean;
  overlayImage?: ImageResource | null;
  thumbnailImage?: ImageResource | null;
}

export interface CustomizationOptionGroup {
  readonly id: string;
  readonly type?: string;
  readonly label: string;
  readonly required?: boolean;
  readonly defaultOptionId?: string;
  readonly instructions?: string;
  options: CustomizationOption[];
  readonly displayHint?: string;
}

export interface CustomizationAsset {
  url: string;
  width?: number | null;
  height?: number | null;
  roles?: readonly string[];
  alt?: string;
  friendlyFileName?: string;
}

export interface CustomizationTextInput {
  id: string;
  type?: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  maxLines?: number;
  instructions?: string;
  [key: string]: unknown;
}

export interface CustomizationPricing {
  readonly currencyCode?: string;
  readonly mode?: string;
  paidOptionGroups?: CustomizationOptionGroup[];
  readonly amounts?: readonly number[];
}

export interface ProductCustomization {
  readonly hasCustomization?: boolean;
  readonly formUrl?: string | null;
  readonly source?: Readonly<Record<string, string>>;
  optionGroups?: CustomizationOptionGroup[];
  textInputs?: CustomizationTextInput[];
  imageInputs?: readonly unknown[];
  fontGroups?: readonly unknown[];
  colorGroups?: readonly unknown[];
  placements?: readonly unknown[];
  surfaces?: readonly unknown[];
  assets?: CustomizationAsset[];
  pricing?: CustomizationPricing;
  widget?: unknown;
  readonly [key: string]: unknown;
}

export interface ProductMediaItem {
  url: string;
  kind?: string;
  sourceAsin?: string;
  alt?: string;
  friendlyFileName?: string;
  readonly [key: string]: unknown;
}

export interface CrawlProduct {
  readonly id?: string;
  readonly parentAsin?: string;
  readonly asin?: string;
  readonly sourcePlatform?: string | null;
  readonly sourceProductId?: string | null;
  readonly canonicalUrl?: string;
  readonly sourceTitle?: string;
  readonly title?: string;
  readonly description?: string;
  readonly descriptionHtml?: string;
  readonly handle?: string;
  readonly seo?: {
    readonly title?: string;
    readonly description?: string;
    readonly aeo_quick_summary?: string;
    readonly aeo_faq?: readonly unknown[];
    readonly aeo_json_ld?: string;
    readonly [key: string]: unknown;
  };
  readonly sourceKey?: string;
  readonly bulletPoints?: readonly string[];
  readonly categories?: readonly string[];
  readonly tags?: readonly string[];
  readonly productDetails?: Record<string, unknown>;
  media?: ProductMediaItem[];
  readonly sourceVariants?: readonly unknown[];
  readonly variants?: readonly unknown[];
  readonly variantMatrix?: unknown;
  customization?: ProductCustomization | null;
  readonly splitContext?: Record<string, unknown>;
  readonly [key: string]: unknown;
}


export interface CrawlJobSettings {
  readonly profileSlug?: string;
  readonly applyJeminisePreset?: boolean;
  readonly productThreads?: number;
  readonly variantThreads?: number;
  readonly [key: string]: unknown;
}

export interface CrawlJobStatistics {
  readonly requestedInputs?: number;
  readonly acceptedInputs?: number;
  readonly rejectedInputs?: number;
  readonly products?: number;
  readonly durationMs?: number;
  readonly [key: string]: unknown;
}

export interface CustomizationNormalizerInput {
  readonly version?: string;
  readonly jobId: string;
  readonly status: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly settings?: CrawlJobSettings;
  readonly products: readonly CrawlProduct[];
  readonly errors?: readonly unknown[];
  readonly warnings?: readonly unknown[];
  readonly statistics?: CrawlJobStatistics;
  readonly exportFilename?: string;
  readonly [key: string]: unknown;
}

export interface NormalizationSummary {
  readonly totalProducts: number;
  readonly customizedProducts: number;
  readonly untouchedProducts: number;
  readonly normalizedAssetsCount: number;
}

export interface CustomizationNormalizerOutput extends CustomizationNormalizerInput {
  readonly products: CrawlProduct[];
  readonly normalizationSummary: NormalizationSummary;
}

export interface PayloadValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface PinterestPodDeliverableItemInput {
  readonly designId: string;
  readonly sourceCandidateId?: string;
  readonly productType?: string;
  readonly originalPinTitle: string;
  readonly trendKeywords?: readonly string[];
  readonly printMaster?: {
    readonly url?: string;
    readonly dimensions?: { readonly width?: number; readonly height?: number };
  };
  readonly cutoutProduct?: {
    readonly transparentUrl?: string;
    readonly whiteBgUrl?: string;
  };
  readonly composedMockups?: readonly {
    readonly mockupUrl: string;
    readonly detectedSceneType?: string;
  }[];
  readonly storeId?: string;
  readonly vendor?: string;
  readonly collectionIds?: readonly string[];
  readonly priceAddition?: number;
  readonly discountPercent?: number;
  readonly variants?: readonly {
    readonly title?: string;
    readonly price: string;
    readonly compareAtPrice?: string;
    readonly sku?: string;
    readonly optionValues?: readonly { readonly optionName: string; readonly name: string }[];
  }[];
  readonly [key: string]: unknown;
}

export interface ShopifyProductInputForNormalization {
  readonly id: string;
  readonly title: string;
  readonly handle?: string;
  readonly descriptionHtml?: string;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly images?: readonly {
    readonly id?: string;
    readonly url: string;
    readonly altText?: string;
  }[];
  readonly variants?: readonly {
    readonly id?: string;
    readonly title?: string;
    readonly price: string;
    readonly sku?: string;
    readonly selectedOptions?: readonly { readonly name: string; readonly value: string }[];
  }[];
  readonly metafields?: readonly {
    readonly namespace: string;
    readonly key: string;
    readonly value: string;
  }[];
  readonly [key: string]: unknown;
}
