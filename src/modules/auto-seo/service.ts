import type {
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoSelectionInput,
  SeoContentInputPayload,
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

  const isSelectAll = !hasSelectedIds && !hasSelectedHandles;
  const selectedProducts: AutoSeoProductCandidate[] = [];
  const seenProductIds = new Set<string>();

  for (const product of input.products) {
    const isMatched =
      isSelectAll ||
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
