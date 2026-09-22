export interface ShopifyCredentials {
  readonly shop: string;
  readonly accessToken: string;
  readonly apiVersion?: string;
}

export interface ShopifySyncOptions {
  readonly dryRun?: boolean;
  readonly credentials?: ShopifyCredentials;
  readonly priceMultiplier?: number;
  readonly gateway?: ShopifyGateway;
  readonly maxThrottleAttempts?: number;
  readonly throttleBaseDelayMs?: number;
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
  readonly formUrl?: string | null;
  readonly [key: string]: unknown;
}

export interface ShopifySyncProductInput {
  readonly id?: string;
  readonly title: string;
  readonly descriptionHtml: string;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
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
}

export interface ShopifySyncBatchOutput {
  readonly jobId?: string;
  readonly totalProducts: number;
  readonly successfulProducts: number;
  readonly failedProducts: number;
  readonly totalAssetsUploaded: number;
  readonly results: readonly ShopifySyncProductResult[];
}

export interface CreateProductInput {
  readonly title: string;
  readonly descriptionHtml: string;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly media?: readonly ShopifyMediaInput[];
  readonly variants?: readonly CreateVariantItem[];
}

export interface CreateProductOutput {
  readonly productId: string;
  readonly productHandle: string;
  readonly createdVariantsCount?: number;
}

export interface CreateVariantItem {
  readonly price: string;
  readonly compareAtPrice?: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly optionValues?: readonly ShopifyVariantOptionValue[];
}

export interface CreateVariantsOutput {
  readonly createdCount: number;
}

export interface UploadFileInput {
  readonly originalSource: string;
  readonly filename: string;
  readonly alt: string;
}

export interface UploadFileOutput {
  readonly fileId: string;
  readonly shopifyCdnUrl: string;
}

export interface SetMetafieldInput {
  readonly productId: string;
  readonly namespace: "custom";
  readonly key: "amazon_customizer";
  readonly type: "json";
  readonly value: string;
}

export interface SetMetafieldOutput {
  readonly success: boolean;
  readonly metafieldId?: string;
}

export interface ShopifyGateway {
  readonly createProduct: (input: CreateProductInput) => Promise<CreateProductOutput>;
  readonly createVariants: (
    productId: string,
    variants: readonly CreateVariantItem[],
  ) => Promise<CreateVariantsOutput>;
  readonly uploadFile: (input: UploadFileInput) => Promise<UploadFileOutput>;
  readonly setProductMetafield: (input: SetMetafieldInput) => Promise<SetMetafieldOutput>;
}

