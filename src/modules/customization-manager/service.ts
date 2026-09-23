import type {
  ProductCustomization,
} from "../customization-normalizer";
import type {
  AssetDiff,
  CleanOrphanAssetsInput,
  CleanOrphanAssetsOutput,
  CloneCustomizationInput,
  CloneCustomizationOutput,
  CreateCustomizationInput,
  CreateCustomizationOutput,
  CustomizationGateway,
  CustomizationGatewayFileSummary,
  CustomizationManagerConfig,
  CustomizationManagerRunner,
  DeleteCustomizationInput,
  DeleteCustomizationOutput,
  PayloadSizeValidationResult,
  ReadCustomizationInput,
  ReadCustomizationOutput,
  UpdateCustomizationInput,
  UpdateCustomizationOutput,
} from "./types";

export const DEFAULT_CONFIG: Required<CustomizationManagerConfig> = {
  defaultNamespace: "custom",
  defaultKey: "amazon_customizer",
  maxMetafieldSizeBytes: 128 * 1024, // 131,072 bytes (Shopify hard limit)
  autoDeduplicateThresholdBytes: 110 * 1024, // 112,640 bytes (safe threshold)
};

const SHOPIFY_FILE_DELETE_BATCH_LIMIT = 250;

// ============================================================================
// Core Service Implementation
// ============================================================================

export async function readCustomization(
  gateway: CustomizationGateway,
  input: ReadCustomizationInput,
  config: CustomizationManagerConfig = {},
): Promise<ReadCustomizationOutput> {
  const namespace = input.namespace ?? config.defaultNamespace ?? DEFAULT_CONFIG.defaultNamespace;
  const key = input.key ?? config.defaultKey ?? DEFAULT_CONFIG.defaultKey;
  const warnings: string[] = [];

  const rawMeta = await gateway.getMetafield({
    ownerId: input.productId,
    namespace,
    key,
  });

  if (!rawMeta.value || rawMeta.value.trim().length === 0) {
    return {
      productId: input.productId,
      exists: false,
      metafieldId: rawMeta.id,
      customization: null,
      byteSize: 0,
      trackedFileIds: [],
      warnings,
    };
  }

  const byteSize = getUtf8ByteSize(rawMeta.value);

  try {
    const parsed = JSON.parse(rawMeta.value) as unknown;
    if (!isRecord(parsed)) {
      warnings.push("Metafield value is valid JSON but does not contain a JSON object.");
      return {
        productId: input.productId,
        exists: true,
        metafieldId: rawMeta.id,
        customization: null,
        byteSize,
        trackedFileIds: [],
        warnings,
      };
    }

    const customization = parsed as ProductCustomization;
    const trackedFileIds = extractAssetFileIds(customization);

    return {
      productId: input.productId,
      exists: true,
      metafieldId: rawMeta.id,
      customization,
      byteSize,
      trackedFileIds,
      warnings,
    };
  } catch (err) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to parse customizer JSON from metafield: ${errorDetail}`);
    return {
      productId: input.productId,
      exists: true,
      metafieldId: rawMeta.id,
      customization: null,
      byteSize,
      trackedFileIds: [],
      warnings,
    };
  }
}

export async function createCustomization(
  gateway: CustomizationGateway,
  input: CreateCustomizationInput,
  config: CustomizationManagerConfig = {},
): Promise<CreateCustomizationOutput> {
  const namespace = input.namespace ?? config.defaultNamespace ?? DEFAULT_CONFIG.defaultNamespace;
  const key = input.key ?? config.defaultKey ?? DEFAULT_CONFIG.defaultKey;
  const warnings: string[] = [];

  if (!input.allowOverwrite) {
    const existing = await gateway.getMetafield({
      ownerId: input.productId,
      namespace,
      key,
    });
    if (existing.value && existing.value.trim().length > 0) {
      throw new Error(
        `Customization already exists for product "${input.productId}". Set allowOverwrite: true to replace.`,
      );
    }
  }

  const { serialized, byteSize, wasOptimized } = prepareAndOptimizePayload(
    input.customization,
    config,
  );

  if (wasOptimized) {
    warnings.push("Payload size exceeded safe threshold; automatic asset deduplication was applied.");
  }

  validatePayloadCeiling(byteSize, config);

  const setResult = await gateway.setMetafield({
    ownerId: input.productId,
    namespace,
    key,
    value: serialized,
    type: "json",
  });

  if (!setResult.success) {
    throw new Error(`Failed to save customizer metafield for product "${input.productId}".`);
  }

  const trackedFileIds = extractAssetFileIds(input.customization);

  return {
    productId: input.productId,
    success: true,
    metafieldId: setResult.metafieldId,
    byteSize,
    trackedFileIds,
    warnings,
  };
}

export async function updateCustomization(
  gateway: CustomizationGateway,
  input: UpdateCustomizationInput,
  config: CustomizationManagerConfig = {},
): Promise<UpdateCustomizationOutput> {
  const namespace = input.namespace ?? config.defaultNamespace ?? DEFAULT_CONFIG.defaultNamespace;
  const key = input.key ?? config.defaultKey ?? DEFAULT_CONFIG.defaultKey;
  const warnings: string[] = [];
  const deletedFileIds: string[] = [];

  let assetDiff: AssetDiff | undefined;

  if (input.autoCleanReplacedAssets) {
    const previous = await readCustomization(gateway, {
      productId: input.productId,
      namespace,
      key,
    }, config);

    if (previous.customization) {
      assetDiff = computeAssetDiff(previous.customization, input.customization);

      const fileIdsToDelete = [
        ...assetDiff.removedFileIds,
        ...(input.knownPreviousFileIds ?? []),
      ].filter((val, idx, arr) => arr.indexOf(val) === idx);

      if (fileIdsToDelete.length > 0) {
        try {
          const deleteRes = await gateway.deleteFiles({ fileIds: fileIdsToDelete });
          deletedFileIds.push(...deleteRes.deletedFileIds);
        } catch (err) {
          const errorDetail = err instanceof Error ? err.message : String(err);
          warnings.push(`Warning: Failed to delete replaced CDN assets: ${errorDetail}`);
        }
      }
    }
  }

  const { serialized, byteSize, wasOptimized } = prepareAndOptimizePayload(
    input.customization,
    config,
  );

  if (wasOptimized) {
    warnings.push("Payload size exceeded safe threshold; automatic asset deduplication was applied.");
  }

  validatePayloadCeiling(byteSize, config);

  const setResult = await gateway.setMetafield({
    ownerId: input.productId,
    namespace,
    key,
    value: serialized,
    type: "json",
  });

  if (!setResult.success) {
    throw new Error(`Failed to update customizer metafield for product "${input.productId}".`);
  }

  return {
    productId: input.productId,
    success: true,
    metafieldId: setResult.metafieldId,
    byteSize,
    assetDiff,
    deletedFileIds,
    warnings,
  };
}

export async function deleteCustomization(
  gateway: CustomizationGateway,
  input: DeleteCustomizationInput,
  config: CustomizationManagerConfig = {},
): Promise<DeleteCustomizationOutput> {
  const namespace = input.namespace ?? config.defaultNamespace ?? DEFAULT_CONFIG.defaultNamespace;
  const key = input.key ?? config.defaultKey ?? DEFAULT_CONFIG.defaultKey;
  const warnings: string[] = [];
  const deletedFileIds: string[] = [];

  if (input.cascadeDeleteFiles) {
    const existing = await readCustomization(gateway, {
      productId: input.productId,
      namespace,
      key,
    }, config);

    const extractedIds = existing.customization
      ? extractAssetFileIds(existing.customization, true) // dedicated only
      : [];

    const fileIdsToDelete = [
      ...extractedIds,
      ...(input.explicitFileIdsToDelete ?? []),
    ].filter((val, idx, arr) => arr.indexOf(val) === idx);

    if (fileIdsToDelete.length > 0) {
      try {
        const deleteRes = await gateway.deleteFiles({ fileIds: fileIdsToDelete });
        deletedFileIds.push(...deleteRes.deletedFileIds);
      } catch (err) {
        const errorDetail = err instanceof Error ? err.message : String(err);
        warnings.push(`Warning: Failed to cascade-delete CDN files: ${errorDetail}`);
      }
    }
  }

  const deleteMetaRes = await gateway.deleteMetafield({
    ownerId: input.productId,
    namespace,
    key,
  });

  return {
    productId: input.productId,
    success: deleteMetaRes.success,
    deletedFileIds,
    warnings,
  };
}

export async function cloneCustomization(
  gateway: CustomizationGateway,
  input: CloneCustomizationInput,
  config: CustomizationManagerConfig = {},
): Promise<CloneCustomizationOutput> {
  const source = await readCustomization(gateway, {
    productId: input.sourceProductId,
    namespace: input.namespace,
    key: input.key,
  }, config);

  if (!source.exists || !source.customization) {
    throw new Error(`Source product "${input.sourceProductId}" has no customization config to clone.`);
  }

  const createRes = await createCustomization(gateway, {
    productId: input.targetProductId,
    customization: source.customization,
    namespace: input.namespace,
    key: input.key,
    allowOverwrite: input.allowOverwrite,
  }, config);

  return {
    sourceProductId: input.sourceProductId,
    targetProductId: input.targetProductId,
    success: createRes.success,
    metafieldId: createRes.metafieldId,
    byteSize: createRes.byteSize,
  };
}

export async function cleanOrphanAssets(
  gateway: CustomizationGateway,
  input: CleanOrphanAssetsInput = {},
): Promise<CleanOrphanAssetsOutput> {
  const tagPrefix = input.tagPrefix ?? "product:";
  const batchSize = input.batchSize ?? SHOPIFY_FILE_DELETE_BATCH_LIMIT;
  const isDryRun = input.dryRun ?? false;

  const queryRes = await gateway.queryFiles({
    query: `tag:${tagPrefix}*`,
    first: 250,
  });

  const files = queryRes.files;
  const orphanFileIds: string[] = [];
  const checkedProductCache = new Map<string, boolean>();

  for (const file of files) {
    const productTag = (file.tags ?? []).find((t) => t.startsWith(tagPrefix));
    if (!productTag) continue;

    const productId = productTag.slice(tagPrefix.length).trim();
    if (!productId) continue;

    let productExists = checkedProductCache.get(productId);
    if (productExists === undefined) {
      if (gateway.getProduct) {
        try {
          const prodRes = await gateway.getProduct({ id: productId });
          productExists = prodRes.product !== null;
        } catch {
          productExists = false;
        }
      } else {
        // If gateway doesn't provide getProduct, cannot confirm orphan status safely
        continue;
      }
      checkedProductCache.set(productId, productExists);
    }

    if (!productExists) {
      orphanFileIds.push(file.id);
    }
  }

  const deletedFileIds: string[] = [];

  if (!isDryRun && orphanFileIds.length > 0) {
    for (let i = 0; i < orphanFileIds.length; i += batchSize) {
      const chunk = orphanFileIds.slice(i, i + batchSize);
      const delRes = await gateway.deleteFiles({ fileIds: chunk });
      deletedFileIds.push(...delRes.deletedFileIds);
    }
  }

  return {
    scannedCount: files.length,
    orphanCount: orphanFileIds.length,
    orphanFileIds,
    deletedFileIds,
    isDryRun,
  };
}

// ============================================================================
// Asset & Payload Helpers
// ============================================================================

export function computeAssetDiff(
  oldCustomization: ProductCustomization,
  newCustomization: ProductCustomization,
): AssetDiff {
  const oldUrls = new Set(extractAssetUrls(oldCustomization));
  const newUrls = new Set(extractAssetUrls(newCustomization));

  const addedUrls = [...newUrls].filter((url) => !oldUrls.has(url));
  const removedUrls = [...oldUrls].filter((url) => !newUrls.has(url));
  const retainedUrls = [...oldUrls].filter((url) => newUrls.has(url));

  const removedFileIds = extractAssetFileIdsForUrls(oldCustomization, new Set(removedUrls));

  return {
    addedUrls,
    removedUrls,
    removedFileIds,
    retainedUrls,
  };
}

export function extractAssetUrls(customization: unknown): string[] {
  const urls: string[] = [];
  collectValues(customization, "url", (val) => {
    if (typeof val === "string" && val.startsWith("http")) {
      urls.push(val);
    }
  });
  return urls.filter((val, idx, arr) => arr.indexOf(val) === idx);
}

export function extractAssetFileIds(
  customization: unknown,
  dedicatedOnly = false,
): string[] {
  const fileIds: string[] = [];

  if (!isRecord(customization)) return fileIds;

  if (Array.isArray(customization.assets)) {
    for (const asset of customization.assets) {
      if (isRecord(asset)) {
        if (dedicatedOnly && asset.isShared === true) continue;
        if (typeof asset.fileId === "string" && asset.fileId.startsWith("gid://shopify/")) {
          fileIds.push(asset.fileId);
        }
      }
    }
  }

  collectValues(customization, "fileId", (val, parent) => {
    if (typeof val === "string" && val.startsWith("gid://shopify/")) {
      if (dedicatedOnly && isRecord(parent) && parent.isShared === true) return;
      fileIds.push(val);
    }
  });

  return fileIds.filter((val, idx, arr) => arr.indexOf(val) === idx);
}

function extractAssetFileIdsForUrls(
  customization: ProductCustomization,
  targetUrls: Set<string>,
): string[] {
  const fileIds: string[] = [];

  if (Array.isArray(customization.assets)) {
    for (const asset of customization.assets) {
      if (isRecord(asset) && typeof asset.url === "string" && targetUrls.has(asset.url)) {
        if (typeof asset.fileId === "string" && asset.fileId.startsWith("gid://shopify/")) {
          fileIds.push(asset.fileId);
        }
      }
    }
  }

  return fileIds.filter((val, idx, arr) => arr.indexOf(val) === idx);
}

export function validateCustomizationPayloadSize(
  customization: ProductCustomization,
  config: CustomizationManagerConfig = {},
): PayloadSizeValidationResult {
  const maxBytes = config.maxMetafieldSizeBytes ?? DEFAULT_CONFIG.maxMetafieldSizeBytes;
  const jsonStr = JSON.stringify(customization);
  const byteSize = getUtf8ByteSize(jsonStr);

  const isSafe = byteSize <= maxBytes;
  let warning: string | undefined;

  if (!isSafe) {
    warning = `Payload size (${byteSize} bytes) exceeds Shopify limit (${maxBytes} bytes).`;
  } else if (byteSize > (config.autoDeduplicateThresholdBytes ?? DEFAULT_CONFIG.autoDeduplicateThresholdBytes)) {
    warning = `Payload size (${byteSize} bytes) is close to the 128KB limit. Deduplication advised.`;
  }

  return { byteSize, isSafe, warning };
}

function prepareAndOptimizePayload(
  customization: ProductCustomization,
  config: CustomizationManagerConfig,
): { serialized: string; byteSize: number; wasOptimized: boolean } {
  let target = customization;
  let serialized = JSON.stringify(target);
  let byteSize = getUtf8ByteSize(serialized);
  let wasOptimized = false;

  const threshold = config.autoDeduplicateThresholdBytes ?? DEFAULT_CONFIG.autoDeduplicateThresholdBytes;

  if (byteSize > threshold && Array.isArray(target.assets) && target.assets.length > 0) {
    const cloned = { ...target };
    delete cloned.assets;
    const optSerialized = JSON.stringify(cloned);
    const optByteSize = getUtf8ByteSize(optSerialized);

    if (optByteSize < byteSize) {
      target = cloned;
      serialized = optSerialized;
      byteSize = optByteSize;
      wasOptimized = true;
    }
  }

  return { serialized, byteSize, wasOptimized };
}

function validatePayloadCeiling(byteSize: number, config: CustomizationManagerConfig): void {
  const maxBytes = config.maxMetafieldSizeBytes ?? DEFAULT_CONFIG.maxMetafieldSizeBytes;
  if (byteSize > maxBytes) {
    throw new Error(
      `Customization payload size (${byteSize} bytes) exceeds Shopify's 128KB limit (${maxBytes} bytes).`,
    );
  }
}

function getUtf8ByteSize(str: string): number {
  return new TextEncoder().encode(str).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectValues(
  obj: unknown,
  targetKey: string,
  onFound: (value: unknown, parent: unknown) => void,
): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectValues(item, targetKey, onFound);
    }
    return;
  }

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (key === targetKey) {
      onFound(val, obj);
    }
    collectValues(val, targetKey, onFound);
  }
}

// ============================================================================
// In-Memory Dry Run / Mock Gateway
// ============================================================================

export function createDryRunCustomizationGateway(): CustomizationGateway {
  const metafields = new Map<string, { id: string; value: string; type?: string }>();
  const files = new Map<string, CustomizationGatewayFileSummary>();
  const products = new Map<string, { id: string; title: string }>();

  let idCounter = 1;

  return {
    async getMetafield(input) {
      const key = `${input.ownerId}:${input.namespace ?? "custom"}:${input.key ?? "amazon_customizer"}`;
      const entry = metafields.get(key);
      return {
        id: entry?.id,
        value: entry?.value ?? null,
        namespace: input.namespace,
        key: input.key,
        type: entry?.type,
      };
    },
    async setMetafield(input) {
      const storeKey = `${input.ownerId}:${input.namespace ?? "custom"}:${input.key ?? "amazon_customizer"}`;
      const id = metafields.get(storeKey)?.id ?? `gid://shopify/Metafield/dry-run-${idCounter++}`;
      metafields.set(storeKey, { id, value: input.value, type: input.type });
      return { success: true, metafieldId: id };
    },
    async deleteMetafield(input) {
      if (input.ownerId) {
        const storeKey = `${input.ownerId}:${input.namespace ?? "custom"}:${input.key ?? "amazon_customizer"}`;
        metafields.delete(storeKey);
      }
      return { success: true };
    },
    async deleteFiles(input) {
      const deletedFileIds: string[] = [];
      for (const id of input.fileIds) {
        files.delete(id);
        deletedFileIds.push(id);
      }
      return { deletedFileIds };
    },
    async queryFiles(input) {
      const matched: CustomizationGatewayFileSummary[] = [];
      const tagSearch = input.query.startsWith("tag:") ? input.query.slice(4).replace("*", "") : "";

      for (const file of files.values()) {
        if (!tagSearch || (file.tags ?? []).some((t) => t.includes(tagSearch))) {
          matched.push(file);
        }
      }
      return { files: matched.slice(0, input.first ?? 250) };
    },
    async getProduct(input) {
      const p = products.get(input.id);
      return { product: p ?? null };
    },
  };
}

// ============================================================================
// Runner Factory
// ============================================================================

export function createCustomizationManagerRunner(
  gateway: CustomizationGateway,
  config: CustomizationManagerConfig = {},
): CustomizationManagerRunner {
  return {
    read: (input) => readCustomization(gateway, input, config),
    create: (input) => createCustomization(gateway, input, config),
    update: (input) => updateCustomization(gateway, input, config),
    delete: (input) => deleteCustomization(gateway, input, config),
    clone: (input) => cloneCustomization(gateway, input, config),
    cleanOrphans: (input) => cleanOrphanAssets(gateway, input),
  };
}
