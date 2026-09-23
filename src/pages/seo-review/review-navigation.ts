import type {
  SeoProductUiViewModel,
  SeoReviewFilterState,
} from "./types";

/**
 * Finds the next logical product to focus on during sequential review.
 *
 * Behavior:
 * 1. If `currentId` is in `products`:
 *    - If there is a product after it, returns the next product.
 *    - If `currentId` is the last product, falls back to the previous product.
 *    - If `currentId` is the only product, returns null.
 * 2. If `currentId` is NOT in `products` (e.g., filtered out or deleted):
 *    - Returns the first available product in `products`, or null if empty.
 */
export function findNextProductInList(
  products: readonly SeoProductUiViewModel[],
  currentId: string,
): SeoProductUiViewModel | null {
  if (products.length === 0) {
    return null;
  }

  const currentIndex = products.findIndex((p) => p.id === currentId);

  // If item not found in current filtered list, default to first available
  if (currentIndex === -1) {
    return products[0] ?? null;
  }

  // 1. Advance to next product in the list if available
  if (currentIndex + 1 < products.length) {
    return products[currentIndex + 1] ?? null;
  }

  // 2. If at the end of the list, fall back to preceding product
  if (currentIndex - 1 >= 0) {
    return products[currentIndex - 1] ?? null;
  }

  // 3. Current item was the sole remaining item
  return null;
}

/**
 * Filters the list of SEO products according to user query, status, and provenance.
 */
export function filterSeoProducts(
  products: readonly SeoProductUiViewModel[],
  filter: SeoReviewFilterState,
): readonly SeoProductUiViewModel[] {
  return products.filter((p) => {
    // 1. Search query
    if (filter.searchQuery.trim()) {
      const query = filter.searchQuery.toLowerCase().trim();
      const titleMatch = p.productTitle.value.toLowerCase().includes(query);
      const handleMatch = p.handle.value.toLowerCase().includes(query);
      const asinMatch = p.asin ? p.asin.toLowerCase().includes(query) : false;
      if (!titleMatch && !handleMatch && !asinMatch) {
        return false;
      }
    }

    // 2. SEO Status filter
    if (filter.statusFilter !== "all" && p.seoStatus.value !== filter.statusFilter) {
      return false;
    }

    // 3. Review Decision filter
    if (filter.decisionFilter !== "all" && p.reviewDecision !== filter.decisionFilter) {
      return false;
    }

    // 4. Only Mock data filter
    if (filter.onlyMockData) {
      const hasMock =
        p.productTitle.source === "mock" ||
        p.productDescription.source === "mock" ||
        p.seoTitle.source === "mock" ||
        p.seoDescription.source === "mock" ||
        p.handle.source === "mock" ||
        p.images.some((img) => img.alt.source === "mock" || img.webpUrl.source === "mock");
      if (!hasMock) {
        return false;
      }
    }

    return true;
  });
}
