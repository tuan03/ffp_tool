interface AmazonProductIdentity {
  readonly asin?: string;
  readonly parentAsin?: string;
  readonly sourceVariants?: readonly unknown[];
}

export interface ExistingAmazonProduct {
  readonly asin: string;
  readonly productId: string;
}

interface SearchResponse {
  readonly products: {
    readonly nodes: readonly { readonly id: string; readonly asin: { readonly value: string } | null }[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string | null };
  };
}

export async function findExistingAmazonProducts({ product, query }: {
  readonly product: AmazonProductIdentity;
  readonly query: <T>(document: string, variables?: Record<string, unknown>) => Promise<T>;
}): Promise<readonly ExistingAmazonProduct[]> {
  const asins = [...new Set([product.asin, ...(product.sourceVariants ?? []).map(variant =>
    variant !== null && typeof variant === "object" && "asin" in variant ? variant.asin : undefined)]
    .filter((asin): asin is string => typeof asin === "string" && /^[A-Z0-9]{10}$/.test(asin)
      && (asin === product.asin || asin !== product.parentAsin)))];
  if (asins.length === 0) throw new Error("AMAZON_EXACT_ASIN_REQUIRED");
  const definitions = await query<{ readonly definition: {
    readonly capabilities: { readonly adminFilterable: { readonly status: string } };
  } | null }>(`query { definition: metafieldDefinition(identifier: {
    namespace: "custom", key: "amazon_asin", ownerType: PRODUCT
  }) { capabilities { adminFilterable { status } } } }`);
  if (definitions.definition?.capabilities.adminFilterable.status !== "FILTERABLE") {
    throw new Error("AMAZON_ASIN_NOT_SEARCHABLE: Cannot verify Shopify duplicates before SEO handoff.");
  }
  const matches: ExistingAmazonProduct[] = [];
  // Exact child identities are authoritative; family metadata can be stale.
  for (const asin of asins) {
    let cursor: string | null = null;
    const visitedCursors = new Set<string>();
    for (;;) {
      const response: SearchResponse = await query<SearchResponse>(`query ExactAmazonAsin($query:String!, $cursor:String) {
        products(first:200, query:$query, after:$cursor) {
          nodes { id asin:metafield(namespace:"custom", key:"amazon_asin") { value } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { query: `metafields.custom.amazon_asin:"${asin}"`, cursor });
      const existing = response.products.nodes.find(candidate => candidate.asin?.value === asin);
      if (existing) {
        matches.push({ asin, productId: existing.id });
        break;
      }
      if (!response.products.pageInfo.hasNextPage) break;
      const nextCursor = response.products.pageInfo.endCursor;
      if (!nextCursor || visitedCursors.has(nextCursor)) throw new Error("AMAZON_ASIN_SEARCH_PAGINATION_FAILED");
      visitedCursors.add(nextCursor);
      cursor = nextCursor;
    }
  }
  // Do not discard an unsynced variant in a mixed product group.
  return matches.length === asins.length ? matches : [];
}
