import { AppError } from "../../shared/errors/app-error";
import type {
  AutoSeoClient,
  AutoSeoBackupRequest,
  AutoSeoBackupResponse,
  AutoSeoBackupBatchProgress,
  AutoSeoSkippedProduct,
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoSelectionInput,
  SeoContentInputPayload,
  ShopifyProductForAutoSeoUi,
} from "./types";

const BACKUP_BATCH_PRODUCTS = 50;
const BACKUP_BATCH_BYTES = 2 * 1024 * 1024;

export async function runAutoSeoBackupBatches(input: {
  readonly client: Pick<AutoSeoClient, "hydrateSelectedProductsFresh" | "runAutoSeoBackup">;
  readonly workflowId: string;
  readonly storeId: string;
  readonly shopDomain: string;
  readonly productIds: readonly string[];
  readonly onProgress?: (progress: AutoSeoBackupBatchProgress) => void;
  readonly onCompletedProductIds?: (ids: readonly string[]) => void;
}): Promise<{ readonly backupResult: AutoSeoBackupResponse; readonly acceptedProducts: readonly ShopifyProductForAutoSeoUi[] }> {
  const productIds = [...new Set(input.productIds)];
  const acceptedProducts: ShopifyProductForAutoSeoUi[] = [];
  const backupIds: string[] = [];
  const skippedProducts: AutoSeoSkippedProduct[] = [];
  let seoProvider: AutoSeoBackupResponse["seoProvider"];
  let reviewPersistedCount = 0;
  let progress: AutoSeoBackupBatchProgress = { total: productIds.length, hydrated: 0, backedUp: 0, handedOver: 0, skipped: 0, alreadyQueued: 0, unchanged: 0, completedBatches: 0, phase: "loading" };
  const report = (change: Partial<AutoSeoBackupBatchProgress>): void => {
    progress = { ...progress, ...change }; input.onProgress?.(progress);
  };
  const request = (products: readonly ShopifyProductForAutoSeoUi[], index: number): AutoSeoBackupRequest => ({
    workflowId: `${input.workflowId}-b${index + 1}`, storeId: input.storeId, shopDomain: input.shopDomain, products,
  });
  try {
    for (let offset = 0; offset < productIds.length; offset += BACKUP_BATCH_PRODUCTS) {
      report({ phase: "loading" });
      const selectedIds = productIds.slice(offset, offset + BACKUP_BATCH_PRODUCTS);
      const products = await input.client.hydrateSelectedProductsFresh(selectedIds, 5, input.storeId);
      if (products.length !== selectedIds.length || new Set(products.map(product => product.id)).size !== selectedIds.length
          || products.some(product => !selectedIds.includes(product.id) || (product.storeId && product.storeId !== input.storeId))) {
        throw new AppError("Dữ liệu sản phẩm/store không khớp; đã dừng trước khi gửi batch.", "AUTO_SEO_BATCH_IDENTITY_MISMATCH");
      }
      report({ hydrated: progress.hydrated + products.length });
      const chunks: ShopifyProductForAutoSeoUi[][] = [];
      let chunk: ShopifyProductForAutoSeoUi[] = [];
      // Measure UTF-8 bytes of the complete envelope, not JS character count.
      for (const product of products) {
        if (new TextEncoder().encode(JSON.stringify(request([product], progress.completedBatches + chunks.length))).length > BACKUP_BATCH_BYTES) {
          throw new AppError(`Sản phẩm ${product.id} vượt giới hạn 2 MiB của một batch; cần kiểm tra dữ liệu trước khi gửi.`, "AUTO_SEO_PRODUCT_TOO_LARGE");
        }
        if (chunk.length && new TextEncoder().encode(JSON.stringify(request([...chunk, product], progress.completedBatches + chunks.length))).length > BACKUP_BATCH_BYTES) {
          chunks.push(chunk); chunk = [];
        }
        chunk.push(product);
      }
      if (chunk.length) chunks.push(chunk);
      for (const batch of chunks) {
        report({ phase: "backup" });
        const batchRequest = request(batch, progress.completedBatches);
        // No blind retry after an unknown HTTP outcome; retain the remaining selection.
        const result = await input.client.runAutoSeoBackup(batchRequest);
        report({ backedUp: progress.backedUp + result.backedUpCount });
        if (result.downstreamStatus !== "SENT") {
          throw new AppError(`Backup đã lưu nhưng bàn giao thất bại: ${result.downstreamError || "Chưa xác nhận được kết quả"}`, "AUTO_SEO_DOWNSTREAM_FAILED");
        }
        const acceptedIds = result.acceptedProductIds ?? (result.backedUpCount === 0 ? [] : batch.map(product => product.id));
        const skippedCount = result.skippedCount ?? batch.length - acceptedIds.length;
        if (result.workflowId !== batchRequest.workflowId || new Set(acceptedIds).size !== acceptedIds.length
            || acceptedIds.some(id => !batch.some(product => product.id === id))
            || (result.acceptedCount !== undefined && result.acceptedCount !== acceptedIds.length)
            || acceptedIds.length + skippedCount !== batch.length) {
          throw new AppError("Phản hồi batch không khớp; giữ phần lựa chọn chưa xác nhận để kiểm tra lại.", "AUTO_SEO_BATCH_RESPONSE_INVALID");
        }
        acceptedProducts.push(...batch.filter(product => acceptedIds.includes(product.id)));
        backupIds.push(...result.backupIds);
        skippedProducts.push(...(result.skippedProducts ?? []));
        reviewPersistedCount += result.reviewPersistedCount ?? 0;
        const alreadyQueued = (result.skippedProducts ?? []).filter(product => product.reason === "ACTIVE_DUPLICATE").length;
        report({ handedOver: progress.handedOver + acceptedIds.length, skipped: progress.skipped + skippedCount,
          alreadyQueued: progress.alreadyQueued + alreadyQueued, unchanged: progress.unchanged + skippedCount - alreadyQueued,
          completedBatches: progress.completedBatches + 1 });
        input.onCompletedProductIds?.(batch.map(product => product.id));
        if (seoProvider && result.seoProvider && seoProvider !== result.seoProvider) {
          throw new AppError("Provider SEO thay đổi giữa các batch; đã dừng phần còn lại.", "AUTO_SEO_BATCH_PROVIDER_CHANGED");
        }
        seoProvider = result.seoProvider ?? seoProvider;
      }
    }
    report({ phase: "completed" });
    return { acceptedProducts, backupResult: {
      workflowId: input.workflowId, backedUpCount: progress.backedUp, backupIds, downstreamStatus: "SENT", seoProvider,
      acceptedProductIds: acceptedProducts.map(product => product.id), acceptedCount: acceptedProducts.length,
      skippedProducts, skippedCount: progress.skipped, reviewPersistedCount,
    } };
  } catch (error: unknown) {
    report({ phase: "failed" });
    throw new AppError(`Đã bàn giao ${progress.handedOver}/${progress.total}, bỏ qua ${progress.skipped}; phần đã thành công được giữ nguyên. ${error instanceof Error ? error.message : "Không hoàn tất được batch."}`, "AUTO_SEO_BATCH_FAILED", error);
  }
}

export async function runAutoSeo(
  input: AutoSeoSelectionInput,
): Promise<AutoSeoOutput> {
  const warnings: string[] = [];

  if (input.products.length === 0) {
    warnings.push("Product list is empty.");
  }

  const hasSelectedIds =
    Array.isArray(input.selectedProductIds) && input.selectedProductIds.length > 0;
  const hasSelectedHandles =
    Array.isArray(input.selectedHandles) && input.selectedHandles.length > 0;

  if (!hasSelectedIds && !hasSelectedHandles) {
    throw new AppError(
      "No products selected. Please select at least one product.",
      "AUTO_SEO_NO_SELECTION",
    );
  }

  const selectedIdSet = new Set(input.selectedProductIds ?? []);
  const selectedHandleSet = new Set(input.selectedHandles ?? []);

  if (hasSelectedIds) {
    for (const id of selectedIdSet) {
      const exists = input.products.some((product) => product.productId === id);
      if (!exists) {
        warnings.push(`Selected product ID not found: ${id}`);
      }
    }
  }

  if (hasSelectedHandles) {
    for (const handle of selectedHandleSet) {
      const exists = input.products.some((product) => product.handle === handle);
      if (!exists) {
        warnings.push(`Selected product handle not found: ${handle}`);
      }
    }
  }

  const selectedProducts: AutoSeoProductCandidate[] = [];
  const seenProductIds = new Set<string>();

  for (const product of input.products) {
    const isMatched =
      selectedIdSet.has(product.productId) ||
      selectedHandleSet.has(product.handle);

    if (isMatched && !seenProductIds.has(product.productId)) {
      seenProductIds.add(product.productId);
      selectedProducts.push(product);
    }
  }

  const seoContentInputs: SeoContentInputPayload[] = selectedProducts.map(
    (product) => {
      validateProduct(product, warnings);

      return {
        productId: product.productId,
        handle: product.handle.trim(),
        sourceTitle: product.title.trim(),
        sourceDescriptionHtml: product.descriptionHtml,
        sourceSeoTitle: product.seoTitle ?? null,
        sourceSeoDescription: product.seoDescription ?? null,
        images: product.images,
      };
    },
  );

  return {
    workflowId: input.workflowId,
    selectedCount: seoContentInputs.length,
    seoContentInputs,
    warnings,
  };
}

function validateProduct(
  product: AutoSeoProductCandidate,
  warnings: string[],
): void {
  if (product.productId.trim().length === 0) {
    warnings.push("Selected product has empty productId.");
  }
  if (product.handle.trim().length === 0) {
    warnings.push(`Selected product ${product.productId} has empty handle.`);
  }
  if (product.title.trim().length === 0) {
    warnings.push(`Selected product ${product.productId} has empty title.`);
  }
  if (product.descriptionHtml.trim().length === 0) {
    warnings.push(
      `Selected product ${product.productId} has empty descriptionHtml.`,
    );
  }
  if (product.images.length === 0) {
    warnings.push(`Selected product ${product.productId} has no images.`);
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const safeLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.max(1, Math.floor(limit))
      : 5;
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (nextIndex < items.length && !firstError) {
      const currentIndex = nextIndex++;
      try {
        results[currentIndex] = await fn(items[currentIndex]!, currentIndex);
      } catch (err) {
        if (!firstError) {
          firstError = err;
        }
        break;
      }
    }
  });

  await Promise.all(workers);

  if (firstError) {
    throw firstError;
  }

  return results;
}

export async function hydrateSelectedProducts(
  client: AutoSeoClient,
  productIds: readonly string[],
  concurrency = 5,
  storeId?: string,
): Promise<readonly ShopifyProductForAutoSeoUi[]> {
  if (typeof client.hydrateSelectedProductsFresh === "function") {
    return client.hydrateSelectedProductsFresh(productIds, concurrency, storeId);
  }

  if (typeof client.hydrateSelectedProducts === "function") {
    return client.hydrateSelectedProducts(productIds, concurrency, storeId);
  }

  if (productIds.length === 0) {
    return [];
  }

  const uniqueIds = Array.from(new Set(productIds));
  const productMap = new Map<string, ShopifyProductForAutoSeoUi>();

  const idsToFetch: string[] = [];
  for (const id of uniqueIds) {
    const cached = client.getCachedDetail?.(id, storeId);
    if (cached) {
      productMap.set(id, cached);
    } else {
      idsToFetch.push(id);
    }
  }

  if (idsToFetch.length > 0) {
    await mapWithConcurrency(idsToFetch, concurrency, async (id) => {
      try {
        const detail = storeId
          ? await client.loadProductDetail(storeId, id)
          : await client.loadProductDetail(id);
        productMap.set(id, detail);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new AppError(
          `Failed to hydrate product detail for product ${id}: ${message}`,
          "AUTO_SEO_LOAD_FAILED",
          err,
        );
      }
    });
  }

  return productIds.map((id) => {
    const product = productMap.get(id);
    if (!product) {
      throw new AppError(
        `Failed to hydrate product detail for product ${id}: product detail not found`,
        "AUTO_SEO_LOAD_FAILED",
      );
    }
    return product;
  });
}
