interface EtsyProductIdentity {
  readonly sourcePlatform?: string | null;
  readonly sourceProductId?: string | null;
  readonly sourceKey?: string;
  readonly sourceVariants?: readonly unknown[];
  readonly variants?: readonly unknown[];
}

export interface ExistingEtsyProduct {
  readonly listingId: string;
  readonly productId: string;
  readonly matchedBy: "etsy_listing_id" | "etsy_listing_url" | "etsy_product_id" | "tag" | "sku";
}

interface SearchVariantNode {
  readonly sku: string | null;
  readonly etsyProductId: { readonly value: string } | null;
}

interface SearchProductNode {
  readonly id: string;
  readonly tags: readonly string[];
  readonly listingId: { readonly value: string } | null;
  readonly listingUrl: { readonly value: string } | null;
  readonly variants: { readonly nodes: readonly SearchVariantNode[] };
}

interface SearchResponse {
  readonly products: {
    readonly nodes: readonly SearchProductNode[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string | null };
  };
}

const ETSY_DUPLICATE_SEARCH_QUERY = `query ExactEtsyListing($query: String!, $cursor: String) {
  products(first: 100, query: $query, after: $cursor) {
    nodes {
      id
      tags
      listingId: metafield(namespace: "custom", key: "etsy_listing_id") { value }
      listingUrl: metafield(namespace: "custom", key: "etsy_listing_url") { value }
      variants(first: 100) {
        nodes {
          sku
          etsyProductId: metafield(namespace: "custom", key: "etsy_product_id") { value }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEtsyNumericId(value: unknown): value is string {
  return typeof value === "string" && /^\d{6,20}$/.test(value.trim());
}

function extractEtsyListingId(product: EtsyProductIdentity): string {
  const explicit = typeof product.sourceProductId === "string" ? product.sourceProductId.trim() : "";
  if (isEtsyNumericId(explicit)) {
    return explicit;
  }
  const sourceKey = typeof product.sourceKey === "string" ? product.sourceKey.trim() : "";
  if (sourceKey.toLowerCase().startsWith("etsy:")) {
    const suffix = sourceKey.slice("etsy:".length).trim();
    if (isEtsyNumericId(suffix)) {
      return suffix;
    }
  }
  throw new Error("ETSY_EXACT_LISTING_ID_REQUIRED");
}

function extractVariantProductIds(product: EtsyProductIdentity): readonly string[] {
  const candidates = new Set<string>();
  for (const list of [product.sourceVariants, product.variants]) {
    if (!Array.isArray(list)) continue;
    for (const rawVariant of list) {
      if (!isRecord(rawVariant)) continue;
      for (const field of ["sourceVariantId", "etsyProductId", "productId"]) {
        const rawValue = rawVariant[field];
        const text = typeof rawValue === "number" ? String(rawValue) : typeof rawValue === "string" ? rawValue.trim() : "";
        if (isEtsyNumericId(text)) {
          candidates.add(text);
        }
      }
    }
  }
  return [...candidates];
}

function matchNode(
  node: SearchProductNode,
  listingId: string,
  variantProductIds: ReadonlySet<string>,
): ExistingEtsyProduct["matchedBy"] | null {
  if (node.listingId?.value.trim() === listingId) {
    return "etsy_listing_id";
  }
  const listingUrl = node.listingUrl?.value.trim() ?? "";
  if (listingUrl) {
    const urlPattern = new RegExp(`(?:^|/listing/)${listingId}(?:[/?#]|$)`, "i");
    if (urlPattern.test(listingUrl)) {
      return "etsy_listing_url";
    }
  }
  if (node.tags.some((tag) => tag.trim().toLowerCase() === `ffp-source:etsy:${listingId}`)) {
    return "tag";
  }
  for (const variant of node.variants.nodes) {
    const variantProductId = variant.etsyProductId?.value.trim() ?? "";
    if (variantProductId && (variantProductId === listingId || variantProductIds.has(variantProductId))) {
      return "etsy_product_id";
    }
    const sku = (variant.sku ?? "").trim();
    if (
      sku === `ETSY-${listingId}` ||
      sku.startsWith(`ETSY-${listingId}-`) ||
      (sku.startsWith("ETSY-") && variantProductIds.has(sku.slice("ETSY-".length)))
    ) {
      return "sku";
    }
  }
  return null;
}

export async function verifyEtsyListingSearchable(
  query: <T>(document: string, variables?: Record<string, unknown>) => Promise<T>,
): Promise<void> {
  const definitions = await query<{
    readonly definition: {
      readonly capabilities: { readonly adminFilterable: { readonly status: string } };
    } | null;
  }>(`query {
    definition: metafieldDefinition(identifier: {
      namespace: "custom",
      key: "etsy_listing_id",
      ownerType: PRODUCT
    }) {
      capabilities { adminFilterable { status } }
    }
  }`);
  if (definitions.definition?.capabilities.adminFilterable.status !== "FILTERABLE") {
    throw new Error("ETSY_LISTING_NOT_SEARCHABLE: Cannot verify Shopify duplicates before SEO handoff.");
  }
}

export async function findExistingEtsyProducts({
  product,
  query,
  isSearchabilityVerified = false,
}: {
  readonly product: EtsyProductIdentity;
  readonly query: <T>(document: string, variables?: Record<string, unknown>) => Promise<T>;
  readonly isSearchabilityVerified?: boolean;
}): Promise<readonly ExistingEtsyProduct[]> {
  const listingId = extractEtsyListingId(product);
  const variantProductIds = extractVariantProductIds(product);
  const variantIdSet = new Set(variantProductIds);

  if (!isSearchabilityVerified) {
    await verifyEtsyListingSearchable(query);
  }

  const matchesByProductId = new Map<string, ExistingEtsyProduct>();

  async function searchAllPages(searchQuery: string): Promise<void> {
    let cursor: string | null = null;
    const visitedCursors = new Set<string>();
    for (;;) {
      const response: SearchResponse = await query<SearchResponse>(ETSY_DUPLICATE_SEARCH_QUERY, {
        query: searchQuery,
        cursor,
      });
      if (!response?.products || !Array.isArray(response.products.nodes)) {
        throw new Error("ETSY_LISTING_SEARCH_BAD_RESPONSE: Cannot read Shopify product search results.");
      }
      for (const candidate of response.products.nodes) {
        const matchedBy = matchNode(candidate, listingId, variantIdSet);
        if (matchedBy && !matchesByProductId.has(candidate.id)) {
          matchesByProductId.set(candidate.id, {
            listingId,
            productId: candidate.id,
            matchedBy,
          });
        }
      }
      if (!response.products.pageInfo.hasNextPage) break;
      const nextCursor = response.products.pageInfo.endCursor;
      if (!nextCursor || visitedCursors.has(nextCursor)) {
        throw new Error("ETSY_LISTING_SEARCH_PAGINATION_FAILED");
      }
      visitedCursors.add(nextCursor);
      cursor = nextCursor;
    }
  }

  await searchAllPages(`metafields.custom.etsy_listing_id:"${listingId}"`);
  if (matchesByProductId.size > 0) {
    return [...matchesByProductId.values()];
  }

  const fallbackClauses = [
    `tag:"ffp-source:etsy:${listingId}"`,
    `sku:ETSY-${listingId}*`,
    `"${listingId}"`,
    ...variantProductIds.slice(0, 10).map((vpId) => `sku:ETSY-${vpId}`),
  ];
  await searchAllPages(`(${fallbackClauses.join(" OR ")})`);

  return [...matchesByProductId.values()];
}
