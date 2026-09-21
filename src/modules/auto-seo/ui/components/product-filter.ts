import type {
  ProductReviewDecision,
  ShopifyProductForAutoSeoUi,
  ShopifyStatusFilter,
} from "../../types";

export type { ShopifyStatusFilter };

export interface AutoSeoFilterCriteria {
  readonly searchQuery: string;
  readonly statusFilter: ShopifyStatusFilter;
  readonly decisionFilter: string;
  readonly decisions: Record<string, ProductReviewDecision>;
  readonly selectedProductIds: readonly string[];
}

export function filterAutoSeoProducts(
  products: readonly ShopifyProductForAutoSeoUi[],
  criteria: AutoSeoFilterCriteria,
): readonly ShopifyProductForAutoSeoUi[] {
  const query = criteria.searchQuery.toLowerCase().trim();
  const targetStatus = criteria.statusFilter;
  const decisionFilter = criteria.decisionFilter;
  const selectedIdSet = new Set(criteria.selectedProductIds);

  return products.filter((product) => {
    // 1. Search Query: matches title, handle, id, or tags
    if (query) {
      const matchesTitle = Boolean(product.title?.toLowerCase().includes(query));
      const matchesHandle = Boolean(product.handle?.toLowerCase().includes(query));
      const matchesId = Boolean(product.id?.toLowerCase().includes(query));
      const matchesTag = product.tags?.some((tag) => Boolean(tag?.toLowerCase().includes(query))) ?? false;

      if (!matchesTitle && !matchesHandle && !matchesId && !matchesTag) {
        return false;
      }
    }

    // 2. Shopify Status Filter
    if (targetStatus !== "all") {
      const productStatus = (product.status ?? "").toUpperCase();
      if (productStatus !== targetStatus) {
        return false;
      }
    }

    // 3. Review Decision Filter
    if (decisionFilter !== "all") {
      if (decisionFilter === "selected") {
        if (!selectedIdSet.has(product.id)) {
          return false;
        }
      } else {
        const decision = criteria.decisions[product.id] ?? "pending";
        if (decision !== decisionFilter) {
          return false;
        }
      }
    }

    return true;
  });
}

export function selectAllVisibleProducts(
  currentSelectedIds: readonly string[],
  visibleProducts: readonly { readonly id: string }[],
): string[] {
  const currentSet = new Set(currentSelectedIds);
  for (const product of visibleProducts) {
    currentSet.add(product.id);
  }
  return Array.from(currentSet);
}

export function clearVisibleProductsSelection(
  currentSelectedIds: readonly string[],
  visibleProducts: readonly { readonly id: string }[],
): string[] {
  const visibleIdSet = new Set(visibleProducts.map((p) => p.id));
  return currentSelectedIds.filter((id) => !visibleIdSet.has(id));
}
