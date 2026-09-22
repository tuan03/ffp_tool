import { AppError } from "../../shared/errors/app-error";
import type {
  AutoSeoClient,
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoSelectionInput,
  SeoContentInputPayload,
  ShopifyProductForAutoSeoUi,
} from "./types";

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
): Promise<readonly ShopifyProductForAutoSeoUi[]> {
  if (typeof client.hydrateSelectedProductsFresh === "function") {
    return client.hydrateSelectedProductsFresh(productIds, concurrency);
  }

  if (typeof client.hydrateSelectedProducts === "function") {
    return client.hydrateSelectedProducts(productIds, concurrency);
  }

  if (productIds.length === 0) {
    return [];
  }

  const uniqueIds = Array.from(new Set(productIds));
  const productMap = new Map<string, ShopifyProductForAutoSeoUi>();

  const idsToFetch: string[] = [];
  for (const id of uniqueIds) {
    const cached = client.getCachedDetail?.(id);
    if (cached) {
      productMap.set(id, cached);
    } else {
      idsToFetch.push(id);
    }
  }

  if (idsToFetch.length > 0) {
    await mapWithConcurrency(idsToFetch, concurrency, async (id) => {
      try {
        const detail = await client.loadProductDetail(id);
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
