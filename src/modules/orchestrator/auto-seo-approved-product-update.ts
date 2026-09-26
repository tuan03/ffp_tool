import { AppError } from "../../shared/errors/app-error";
import type {
  ModuleApiRunner,
  ShopifyProductBulkUpdateItem,
  ShopifyProductsBulkUpdateResponse,
  ShopifyProductsUpdateResponse,
  ShopifyProductUpdateInput,
} from "../module-api";

export type ApprovedProductPatch = ShopifyProductUpdateInput;

export interface ApprovedProductUpdate {
  readonly productId: string;
  readonly patch: ApprovedProductPatch;
}

export interface ApplyApprovedProductUpdatesInput {
  readonly workflowId: string;
  readonly storeId: string;
  readonly products: readonly ApprovedProductUpdate[];
}

export interface ApprovedProductUpdateItemResult {
  readonly productId: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly errorCode?: string;
  readonly reconciliationRequired?: boolean;
}

export interface ApplyApprovedProductUpdatesResult {
  readonly workflowId: string;
  readonly requestedCount: number;
  readonly successCount: number;
  readonly failedCount: number;
  readonly items: readonly ApprovedProductUpdateItemResult[];
}

export function hasWritableChanges(patch: ApprovedProductPatch | undefined | null): boolean {
  if (!patch || typeof patch !== "object") {
    return false;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    if (key === "seo") {
      if (typeof value === "object" && value !== null) {
        const hasSeoField = Object.entries(value).some(([_, v]) => v !== undefined);
        if (hasSeoField) {
          return true;
        }
      }
      continue;
    }

    return true;
  }

  return false;
}

function sanitizePatch(patch: ApprovedProductPatch): ApprovedProductPatch {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    if (key === "seo" && typeof value === "object" && value !== null) {
      const seoResult: Record<string, unknown> = {};
      for (const [seoKey, seoVal] of Object.entries(value)) {
        if (seoVal !== undefined) {
          seoResult[seoKey] = seoVal;
        }
      }
      result.seo = seoResult;
      continue;
    }

    result[key] = value;
  }

  return result as ApprovedProductPatch;
}

function validateApprovedProductUpdatesInput(input: ApplyApprovedProductUpdatesInput): void {
  if (!input || typeof input !== "object") {
    throw new AppError("Input must be an object", "AUTO_SEO_APPROVED_UPDATE_INVALID_INPUT");
  }

  if (typeof input.workflowId !== "string" || input.workflowId.trim() === "") {
    throw new AppError("workflowId is required", "AUTO_SEO_APPROVED_UPDATE_INVALID_INPUT");
  }

  if (typeof input.storeId !== "string" || input.storeId.trim() === "") {
    throw new AppError("storeId is required", "AUTO_SEO_APPROVED_UPDATE_INVALID_INPUT");
  }

  if (!Array.isArray(input.products) || input.products.length === 0) {
    throw new AppError("products array must not be empty", "AUTO_SEO_APPROVED_UPDATE_EMPTY");
  }

  const seenProductIds = new Set<string>();

  for (const item of input.products) {
    if (!item || typeof item !== "object") {
      throw new AppError("Each product update must be an object", "AUTO_SEO_APPROVED_UPDATE_INVALID_INPUT");
    }

    if (typeof item.productId !== "string" || item.productId.trim() === "") {
      throw new AppError("productId is required for every product", "AUTO_SEO_APPROVED_UPDATE_INVALID_INPUT");
    }

    const trimmedId = item.productId.trim();
    if (seenProductIds.has(trimmedId)) {
      throw new AppError(
        `Duplicate productId found: ${trimmedId}`,
        "AUTO_SEO_APPROVED_UPDATE_DUPLICATE_PRODUCT",
      );
    }
    seenProductIds.add(trimmedId);

    if (!hasWritableChanges(item.patch)) {
      throw new AppError(
        `Product patch contains no writable changes for product: ${trimmedId}`,
        "AUTO_SEO_APPROVED_UPDATE_EMPTY_PATCH",
      );
    }
  }
}

export async function applyApprovedProductUpdates(
  moduleApiRunner: ModuleApiRunner,
  input: ApplyApprovedProductUpdatesInput,
): Promise<ApplyApprovedProductUpdatesResult> {
  validateApprovedProductUpdatesInput(input);

  const cleanStoreId = input.storeId.trim();
  const cleanWorkflowId = input.workflowId.trim();

  // Single product update path
  if (input.products.length === 1) {
    const singleProduct = input.products[0];
    const cleanProductId = singleProduct.productId.trim();
    const cleanPatch = sanitizePatch(singleProduct.patch);
    const requestId = `auto-seo-approved:${cleanWorkflowId}:${cleanProductId}`;

    const response = (await moduleApiRunner({
      storeId: cleanStoreId,
      requestId,
      mode: "apply",
      operation: "products.update",
      payload: {
        id: cleanProductId,
        product: cleanPatch,
      },
    })) as ShopifyProductsUpdateResponse;

    const isSuccess = response?.success === true;

    return {
      workflowId: cleanWorkflowId,
      requestedCount: 1,
      successCount: isSuccess ? 1 : 0,
      failedCount: isSuccess ? 0 : 1,
      items: [
        {
          productId: cleanProductId,
          ok: isSuccess,
        },
      ],
    };
  }

  // Multiple products bulk update path
  const requestId = `auto-seo-approved:${cleanWorkflowId}:bulk`;
  const bulkItems: ShopifyProductBulkUpdateItem[] = input.products.map((item) => ({
    id: item.productId.trim(),
    product: sanitizePatch(item.patch),
  }));

  const response = (await moduleApiRunner({
    storeId: cleanStoreId,
    requestId,
    mode: "apply",
    operation: "products.bulkUpdate",
    payload: {
      products: bulkItems,
    },
  })) as ShopifyProductsBulkUpdateResponse;

  const data = response?.data;
  const itemsMap = new Map<string, {
    readonly ok: boolean;
    readonly error?: string;
    readonly errorCode?: string;
    readonly reconciliationRequired?: boolean;
  }>();

  if (Array.isArray(data?.items)) {
    for (const item of data.items) {
      itemsMap.set(item.id, {
        ok: item.ok,
        error: item.error,
        errorCode: item.errorCode,
        reconciliationRequired: item.reconciliationRequired,
      });
    }
  }

  const updatedIdsSet = new Set(data?.updatedProductIds ?? []);

  const normalizedItems: ApprovedProductUpdateItemResult[] = input.products.map((product) => {
    const trimmedId = product.productId.trim();
    const itemResult = itemsMap.get(trimmedId);

    if (itemResult) {
      const item: {
        productId: string;
        ok: boolean;
        error?: string;
        errorCode?: string;
        reconciliationRequired?: boolean;
      } = {
        productId: trimmedId,
        ok: itemResult.ok,
      };
      if (itemResult.error !== undefined) {
        item.error = itemResult.error;
      }
      if (itemResult.errorCode !== undefined) {
        item.errorCode = itemResult.errorCode;
      }
      if (itemResult.reconciliationRequired !== undefined) {
        item.reconciliationRequired = itemResult.reconciliationRequired;
      }
      return item;
    }

    const isUpdated = updatedIdsSet.has(trimmedId);
    const item: {
      productId: string;
      ok: boolean;
      reconciliationRequired?: boolean;
    } = {
      productId: trimmedId,
      ok: isUpdated,
    };
    if (data?.reconciliationRequired !== undefined) {
      item.reconciliationRequired = data.reconciliationRequired;
    }
    return item;
  });

  const computedSuccessCount = data?.successCount ?? normalizedItems.filter((i) => i.ok).length;
  const computedFailedCount = data?.failedCount ?? normalizedItems.filter((i) => !i.ok).length;

  return {
    workflowId: cleanWorkflowId,
    requestedCount: input.products.length,
    successCount: computedSuccessCount,
    failedCount: computedFailedCount,
    items: normalizedItems,
  };
}
