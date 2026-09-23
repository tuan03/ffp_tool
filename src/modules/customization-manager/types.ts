import type {
  CustomizationAsset,
  CustomizationOption,
  CustomizationOptionGroup,
  ProductCustomization,
} from "../customization-normalizer";

// ============================================================================
// External Gateway Contract (Dependency Inversion)
// Implemented by module-api / gateway adapter to keep this module decoupled.
// ============================================================================

export interface CustomizationGatewayMetafieldGetInput {
  readonly ownerId: string;
  readonly namespace?: string;
  readonly key?: string;
}

export interface CustomizationGatewayMetafieldGetOutput {
  readonly id?: string;
  readonly value: string | null;
  readonly namespace?: string;
  readonly key?: string;
  readonly type?: string;
}

export interface CustomizationGatewayMetafieldSetInput {
  readonly ownerId: string;
  readonly namespace?: string;
  readonly key?: string;
  readonly value: string;
  readonly type?: string;
}

export interface CustomizationGatewayMetafieldSetOutput {
  readonly success: boolean;
  readonly metafieldId?: string;
}

export interface CustomizationGatewayMetafieldDeleteInput {
  readonly id?: string;
  readonly ownerId?: string;
  readonly namespace?: string;
  readonly key?: string;
}

export interface CustomizationGatewayMetafieldDeleteOutput {
  readonly success: boolean;
}

export interface CustomizationGatewayFileDeleteInput {
  readonly fileIds: readonly string[];
}

export interface CustomizationGatewayFileDeleteOutput {
  readonly deletedFileIds: readonly string[];
  readonly userErrors?: readonly string[];
}

export interface CustomizationGatewayFileSummary {
  readonly id: string;
  readonly url: string;
  readonly altText?: string;
  readonly tags?: readonly string[];
  readonly fileStatus?: string;
}

export interface CustomizationGatewayFilesQueryInput {
  readonly query: string;
  readonly first?: number;
}

export interface CustomizationGatewayFilesQueryOutput {
  readonly files: readonly CustomizationGatewayFileSummary[];
}

export interface CustomizationGatewayProductSummary {
  readonly id: string;
  readonly handle?: string;
  readonly title?: string;
  readonly status?: string;
}

export interface CustomizationGatewayProductGetInput {
  readonly id: string;
}

export interface CustomizationGatewayProductGetOutput {
  readonly product: CustomizationGatewayProductSummary | null;
}

export interface CustomizationGateway {
  getMetafield: (
    input: CustomizationGatewayMetafieldGetInput,
  ) => Promise<CustomizationGatewayMetafieldGetOutput>;
  setMetafield: (
    input: CustomizationGatewayMetafieldSetInput,
  ) => Promise<CustomizationGatewayMetafieldSetOutput>;
  deleteMetafield: (
    input: CustomizationGatewayMetafieldDeleteInput,
  ) => Promise<CustomizationGatewayMetafieldDeleteOutput>;
  deleteFiles: (
    input: CustomizationGatewayFileDeleteInput,
  ) => Promise<CustomizationGatewayFileDeleteOutput>;
  queryFiles: (
    input: CustomizationGatewayFilesQueryInput,
  ) => Promise<CustomizationGatewayFilesQueryOutput>;
  getProduct?: (
    input: CustomizationGatewayProductGetInput,
  ) => Promise<CustomizationGatewayProductGetOutput>;
}

// ============================================================================
// Asset Tracking & Lifecycle Types
// ============================================================================

export interface CustomizerTrackedAsset extends CustomizationAsset {
  readonly fileId?: string;
  readonly isShared?: boolean;
}

export interface AssetDiff {
  readonly addedUrls: readonly string[];
  readonly removedUrls: readonly string[];
  readonly removedFileIds: readonly string[];
  readonly retainedUrls: readonly string[];
}

export interface PayloadSizeValidationResult {
  readonly byteSize: number;
  readonly isSafe: boolean;
  readonly warning?: string;
}

// ============================================================================
// Core Module CRUD Input & Output Contracts
// ============================================================================

export interface ReadCustomizationInput {
  readonly productId: string;
  readonly namespace?: string;
  readonly key?: string;
}

export interface ReadCustomizationOutput {
  readonly productId: string;
  readonly exists: boolean;
  readonly metafieldId?: string;
  readonly customization: ProductCustomization | null;
  readonly byteSize: number;
  readonly trackedFileIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface CreateCustomizationInput {
  readonly productId: string;
  readonly customization: ProductCustomization;
  readonly namespace?: string;
  readonly key?: string;
  readonly allowOverwrite?: boolean;
}

export interface CreateCustomizationOutput {
  readonly productId: string;
  readonly success: boolean;
  readonly metafieldId?: string;
  readonly byteSize: number;
  readonly trackedFileIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface UpdateCustomizationInput {
  readonly productId: string;
  readonly customization: ProductCustomization;
  readonly namespace?: string;
  readonly key?: string;
  /**
   * If true, old assets that were removed or replaced will automatically
   * be deleted from Shopify CDN (via gateway.deleteFiles).
   */
  readonly autoCleanReplacedAssets?: boolean;
  /**
   * List of specific fileIds known to be replaced or orphaned.
   */
  readonly knownPreviousFileIds?: readonly string[];
}

export interface UpdateCustomizationOutput {
  readonly productId: string;
  readonly success: boolean;
  readonly metafieldId?: string;
  readonly byteSize: number;
  readonly assetDiff?: AssetDiff;
  readonly deletedFileIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface DeleteCustomizationInput {
  readonly productId: string;
  readonly namespace?: string;
  readonly key?: string;
  /**
   * If true, all dedicated CDN assets attached to this customization
   * will be deleted from Shopify CDN.
   */
  readonly cascadeDeleteFiles?: boolean;
  /**
   * Explicit fileIds to delete if not derivable from metafield.
   */
  readonly explicitFileIdsToDelete?: readonly string[];
}

export interface DeleteCustomizationOutput {
  readonly productId: string;
  readonly success: boolean;
  readonly deletedFileIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface CleanOrphanAssetsInput {
  readonly tagPrefix?: string;
  readonly batchSize?: number;
  readonly dryRun?: boolean;
}

export interface CleanOrphanAssetsOutput {
  readonly scannedCount: number;
  readonly orphanCount: number;
  readonly orphanFileIds: readonly string[];
  readonly deletedFileIds: readonly string[];
  readonly isDryRun: boolean;
}

export interface CloneCustomizationInput {
  readonly sourceProductId: string;
  readonly targetProductId: string;
  readonly namespace?: string;
  readonly key?: string;
  readonly allowOverwrite?: boolean;
}

export interface CloneCustomizationOutput {
  readonly sourceProductId: string;
  readonly targetProductId: string;
  readonly success: boolean;
  readonly metafieldId?: string;
  readonly byteSize: number;
}

// ============================================================================
// Service Runner & Configuration
// ============================================================================

export interface CustomizationManagerConfig {
  readonly defaultNamespace?: string;
  readonly defaultKey?: string;
  readonly maxMetafieldSizeBytes?: number;
  readonly autoDeduplicateThresholdBytes?: number;
}

export interface CustomizationManagerRunner {
  read: (input: ReadCustomizationInput) => Promise<ReadCustomizationOutput>;
  create: (input: CreateCustomizationInput) => Promise<CreateCustomizationOutput>;
  update: (input: UpdateCustomizationInput) => Promise<UpdateCustomizationOutput>;
  delete: (input: DeleteCustomizationInput) => Promise<DeleteCustomizationOutput>;
  clone: (input: CloneCustomizationInput) => Promise<CloneCustomizationOutput>;
  cleanOrphans: (input?: CleanOrphanAssetsInput) => Promise<CleanOrphanAssetsOutput>;
}
