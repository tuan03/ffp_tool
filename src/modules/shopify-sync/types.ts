export interface ShopifyCredentials {
  readonly shop: string;
  readonly accessToken: string;
  readonly apiVersion?: string;
}

export interface ShopifySeoInput {
  readonly title: string;
  readonly description: string;
}

export interface ShopifyAeoFaqItem {
  readonly question: string;
  readonly answer: string;
}

export interface ShopifyAeoInput {
  readonly quickSummary: string;
  readonly faq: readonly ShopifyAeoFaqItem[];
  readonly jsonLd: string;
}

export interface ShopifySyncOptions {
  readonly signal?: AbortSignal;
  readonly dryRun?: boolean;
  readonly credentials?: ShopifyCredentials;
  readonly priceMultiplier?: number;
  readonly gateway?: ShopifyGateway;
  readonly maxThrottleAttempts?: number;
  readonly throttleBaseDelayMs?: number;
  readonly existingProductId?: string;
  readonly existingManagedResources?: ShopifyManagedResources;
  readonly sourceShopifyUpdatedAt?: string;
  readonly expectedUpdatedAt?: string;
  readonly force?: boolean;
}

export interface ShopifyVersionConflictDetails {
  readonly code: "SHOPIFY_VERSION_CONFLICT";
  readonly productId: string;
  readonly sourceShopifyUpdatedAt: string;
  readonly currentShopifyUpdatedAt: string;
  readonly currentProduct?: {
    readonly id?: string;
    readonly title: string;
    readonly handle: string;
    readonly descriptionHtml?: string;
    readonly seo?: {
      readonly title?: string;
      readonly description?: string;
    };
  };
  readonly message?: string;
}

export interface ShopifyManagedResources {
  readonly tags?: readonly string[];
  readonly mediaIds?: readonly string[];
  readonly variantIds?: readonly string[];
}

export interface ShopifyMediaInput {
  readonly originalSource: string;
  readonly alt?: string;
  readonly mediaContentType?: "IMAGE" | "VIDEO";
  readonly friendlyFileName?: string;
}

export interface ShopifyVariantOptionValue {
  readonly name: string;
  readonly optionName: string;
}

export interface ShopifyVariantInput {
  readonly title?: string;
  readonly price: string;
  readonly compareAtPrice?: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly inventoryTracked?: boolean;
  readonly optionValues?: readonly ShopifyVariantOptionValue[];
  readonly mediaUrl?: string;
}

export interface ShopifyCustomizationAssetInput {
  readonly url: string;
  readonly alt?: string;
  readonly friendlyFileName?: string;
  readonly roles?: readonly string[];
  readonly width?: number | null;
  readonly height?: number | null;
}

export interface ShopifyProductCustomizerInput {
  readonly hasCustomization: boolean;
  readonly rawConfig?: Record<string, unknown>;
  readonly assets?: readonly ShopifyCustomizationAssetInput[];
  readonly optionGroups?: readonly Record<string, unknown>[];
  readonly pricing?: Record<string, unknown>;
  readonly textInputs?: readonly Record<string, unknown>[];
  readonly surfaces?: readonly Record<string, unknown>[];
  readonly placements?: readonly Record<string, unknown>[];
  readonly product?: Record<string, unknown>;
  readonly controlOrder?: readonly Record<string, unknown>[];
  readonly formUrl?: string | null;
  readonly [key: string]: unknown;
}

export interface ShopifySyncProductInput {
  readonly id?: string;
  readonly sourceKey?: string;
  readonly amazonAsin?: string;
  readonly amazonParentAsin?: string;
  readonly title: string;
  readonly descriptionHtml: string;
  readonly handle?: string;
  readonly seo?: ShopifySeoInput;
  readonly aeo?: ShopifyAeoInput;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly collectionsToJoin?: readonly string[];
  readonly media?: readonly ShopifyMediaInput[];
  readonly options?: readonly string[];
  readonly variants?: readonly ShopifyVariantInput[];
  readonly customization?: ShopifyProductCustomizerInput | null;
  readonly sourceUrl?: string;
}

export interface ShopifySyncBatchInput {
  readonly jobId?: string;
  readonly products: readonly ShopifySyncProductInput[];
}

export interface ShopifySyncProductResult {
  readonly success: boolean;
  readonly sourceId?: string;
  readonly productId?: string;
  readonly productHandle?: string;
  readonly title: string;
  readonly variantsCount: number;
  readonly mediaCount: number;
  readonly assetsUploadedCount: number;
  readonly metafieldSet: boolean;
  readonly dryRun: boolean;
  readonly warnings: readonly string[];
  readonly error?: string;
  readonly details?: ShopifyVersionConflictDetails | Record<string, unknown>;
  readonly conflictDetails?: ShopifyVersionConflictDetails;
  readonly reconciliationRequired?: boolean;
  readonly managedResources?: ShopifyManagedResources;
  readonly timings?: ShopifySyncTimings;
}

export interface ShopifySyncTimings {
  readonly productWriteMs: number;
  readonly variantsMs: number;
  readonly assetUploadMs: number;
  readonly metafieldMs: number;
  readonly totalMs: number;
}

export interface ShopifySyncBatchOutput {
  readonly jobId?: string;
  readonly totalProducts: number;
  readonly successfulProducts: number;
  readonly failedProducts: number;
  readonly totalAssetsUploaded: number;
  readonly results: readonly ShopifySyncProductResult[];
}

export interface ShopifyMetafieldInput {
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly type?: string;
  readonly ownerId?: string;
}

export interface CreateProductInput {
  readonly title: string;
  readonly handle?: string;
  readonly seo?: ShopifySeoInput;
  readonly status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
  readonly descriptionHtml: string;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly collectionsToJoin?: readonly string[];
  readonly media?: readonly ShopifyMediaInput[];
  readonly variants?: readonly CreateVariantItem[];
  readonly metafields?: readonly ShopifyMetafieldInput[];
}

export interface CreateProductOutput {
  readonly productId: string;
  readonly productHandle: string;
  readonly createdVariantsCount?: number;
  readonly managedResources?: ShopifyManagedResources;
}

export interface UpdateProductInput extends CreateProductInput {
  readonly productId: string;
  readonly previousManagedResources?: ShopifyManagedResources;
  readonly expectedUpdatedAt?: string;
  readonly force?: boolean;
}

export interface UpdateProductOutput extends CreateProductOutput {}

export interface CreateVariantItem {
  readonly price: string;
  readonly compareAtPrice?: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly inventoryTracked?: boolean;
  readonly optionValues?: readonly ShopifyVariantOptionValue[];
  readonly mediaUrl?: string;
}

export interface CreateVariantsOutput {
  readonly createdCount: number;
}

export interface UploadFileInput {
  readonly originalSource: string;
  readonly filename: string;
  readonly alt?: string;
  readonly contentType?: "IMAGE" | "FILE";
}

export interface UploadFileOutput {
  readonly fileId: string;
  readonly shopifyCdnUrl: string;
  readonly originalSource?: string;
}

export interface SetMetafieldInput {
  readonly productId: string;
  readonly namespace: string;
  readonly key: string;
  readonly type: "json" | "multi_line_text_field" | "single_line_text_field";
  readonly value: string;
}

export interface SetMetafieldOutput {
  readonly success: boolean;
  readonly metafieldId?: string;
}

export interface ShopifyGateway {
  readonly createProduct: (input: CreateProductInput) => Promise<CreateProductOutput>;
  readonly updateProduct?: (input: UpdateProductInput) => Promise<UpdateProductOutput>;
  readonly deleteProduct?: (productId: string) => Promise<{ success: boolean }>;
  readonly createVariants: (
    productId: string,
    variants: readonly CreateVariantItem[],
  ) => Promise<CreateVariantsOutput>;
  readonly uploadFile: (input: UploadFileInput) => Promise<UploadFileOutput>;
  readonly uploadFilesBatch?: (
    inputs: readonly UploadFileInput[],
  ) => Promise<readonly UploadFileOutput[]>;
  readonly deleteFiles?: (input: { fileIds: readonly string[] }) => Promise<{ deletedFileIds: readonly string[] }>;
  readonly setProductMetafield: (input: SetMetafieldInput) => Promise<SetMetafieldOutput>;
}

export interface RollbackSyncInput {
  readonly productId: string;
  readonly managedResources?: ShopifyManagedResources;
  readonly reason?: string;
  readonly archiveOnly?: boolean;
}

export interface RollbackSyncResult {
  readonly productId: string;
  readonly rolledBack: boolean;
  readonly actionTaken: "deleted" | "archived" | "cleaned_resources" | "none";
  readonly deletedFileIds?: readonly string[];
  readonly warnings?: readonly string[];
  readonly error?: string;
}

