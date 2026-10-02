import type {
  AutoSeoEligibilityItem,
  ProductReviewDecision,
  ShopifyProductForAutoSeoUi,
  ShopifyStatusFilter,
} from "../../types";
import type { AutoSeoEligibilityFilter } from "../smart-batch";

export type { ShopifyStatusFilter };

export interface AutoSeoFilterCriteria {
  readonly searchQuery?: string;
  readonly statusFilter?: ShopifyStatusFilter;
  readonly decisionFilter?: string;
  readonly decisions?: Record<string, ProductReviewDecision>;
  readonly selectedProductIds?: readonly string[];
  readonly eligibilityFilter?: AutoSeoEligibilityFilter;
  readonly eligibilityItems?: readonly AutoSeoEligibilityItem[];
  readonly collectionFilter?: string;
  readonly asinQuery?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

export function filterAutoSeoProducts(
  products: readonly ShopifyProductForAutoSeoUi[],
  criteria: AutoSeoFilterCriteria,
): readonly ShopifyProductForAutoSeoUi[] {
  const query = criteria.searchQuery ? criteria.searchQuery.toLowerCase().trim() : "";
  const targetStatus = criteria.statusFilter ?? "all";
  const decisionFilter = criteria.decisionFilter;
  const selectedIdSet = criteria.selectedProductIds ? new Set(criteria.selectedProductIds) : null;
  const eligibilityByProductId = new Map(
    (criteria.eligibilityItems ?? []).map(item => [item.productId, item] as const),
  );
  const asinQuery = criteria.asinQuery ? criteria.asinQuery.toUpperCase().trim() : "";
  const collectionFilter =
    criteria.collectionFilter && criteria.collectionFilter !== "all"
      ? criteria.collectionFilter.toLowerCase().trim()
      : "";

  return products.filter((product) => {
    // 1. Search Query: matches title, handle, id, tags, or variant sku/barcode
    if (query) {
      const matchesTitle = Boolean(product.title?.toLowerCase().includes(query));
      const matchesHandle = Boolean(product.handle?.toLowerCase().includes(query));
      const matchesId = Boolean(product.id?.toLowerCase().includes(query));
      const matchesTag = product.tags?.some((tag) => Boolean(tag?.toLowerCase().includes(query))) ?? false;
      const matchesSku = product.variants?.some((v) =>
        Boolean(v.sku?.toLowerCase().includes(query) || v.barcode?.toLowerCase().includes(query)),
      ) ?? false;

      if (!matchesTitle && !matchesHandle && !matchesId && !matchesTag && !matchesSku) {
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

    // 3. SEO Eligibility Status Filter
    if (criteria.eligibilityFilter === "needs_seo") {
      const state = eligibilityByProductId.get(product.id)?.state;
      if (state !== "never_processed" && state !== "changed" && state !== "retry") {
        return false;
      }
    } else if (criteria.eligibilityFilter === "active") {
      const state = eligibilityByProductId.get(product.id)?.state;
      if (state !== "active") {
        return false;
      }
    } else if (criteria.eligibilityFilter === "current") {
      const state = eligibilityByProductId.get(product.id)?.state;
      if (state !== "current") {
        return false;
      }
    }

    // 4. Collection / Product Type Filter
    if (collectionFilter) {
      const matchesType = product.productType?.toLowerCase().trim() === collectionFilter;
      const matchesVendor = product.vendor?.toLowerCase().trim() === collectionFilter;
      const matchesTag = product.tags?.some((tag) => {
        const lower = tag.toLowerCase().trim();
        return (
          lower === collectionFilter ||
          lower === `collection:${collectionFilter}` ||
          lower === `col:${collectionFilter}`
        );
      }) ?? false;

      if (!matchesType && !matchesVendor && !matchesTag) {
        return false;
      }
    }

    // 5. Amazon ASIN Filter
    if (asinQuery) {
      const matchesTag = product.tags?.some((tag) => {
        const upper = tag.toUpperCase().trim();
        return (
          upper === asinQuery ||
          upper === `ASIN:${asinQuery}` ||
          upper === `ASIN_${asinQuery}` ||
          upper.includes(asinQuery)
        );
      }) ?? false;
      const matchesSku = product.variants?.some((v) => {
        const sku = v.sku?.toUpperCase() ?? "";
        const barcode = v.barcode?.toUpperCase() ?? "";
        return sku.includes(asinQuery) || barcode.includes(asinQuery);
      }) ?? false;
      const matchesHandle = product.handle?.toUpperCase().includes(asinQuery) ?? false;
      const matchesId = product.id?.toUpperCase().includes(asinQuery) ?? false;
      const matchesTitle = product.title?.toUpperCase().includes(asinQuery) ?? false;

      if (!matchesTag && !matchesSku && !matchesHandle && !matchesId && !matchesTitle) {
        return false;
      }
    }

    // 6. Upload Date Range Filter (createdAt, fallback updatedAt)
    if (criteria.startDate || criteria.endDate) {
      const dateString = product.createdAt || product.updatedAt;
      if (dateString) {
        const productTimestamp = Date.parse(dateString);
        if (!Number.isNaN(productTimestamp)) {
          if (criteria.startDate) {
            const startTimestamp = Date.parse(`${criteria.startDate}T00:00:00`);
            if (!Number.isNaN(startTimestamp) && productTimestamp < startTimestamp) {
              return false;
            }
          }
          if (criteria.endDate) {
            const endTimestamp = Date.parse(`${criteria.endDate}T23:59:59.999`);
            if (!Number.isNaN(endTimestamp) && productTimestamp > endTimestamp) {
              return false;
            }
          }
        }
      }
    }

    // 3. Review Decision Filter (optional)
    if (decisionFilter && decisionFilter !== "all") {
      if (decisionFilter === "selected") {
        if (!selectedIdSet || !selectedIdSet.has(product.id)) {
          return false;
        }
      } else if (criteria.decisions) {
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
