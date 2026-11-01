import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

const DEFINITION_QUERY = `query EtsyListingDefinitions {
  listingId: metafieldDefinition(identifier: { namespace: "custom", key: "etsy_listing_id", ownerType: PRODUCT }) {
    type { name }
    capabilities { adminFilterable { enabled status } }
  }
  listingUrl: metafieldDefinition(identifier: { namespace: "custom", key: "etsy_listing_url", ownerType: PRODUCT }) {
    type { name }
  }
  variantProductId: metafieldDefinition(identifier: { namespace: "custom", key: "etsy_product_id", ownerType: PRODUCTVARIANT }) {
    type { name }
  }
}`;

const CREATE_LISTING_ID_DEFINITION = `mutation CreateEtsyListingIdDefinition {
  metafieldDefinitionCreate(definition: {
    name: "Etsy Listing ID",
    namespace: "custom",
    key: "etsy_listing_id",
    ownerType: PRODUCT,
    type: "single_line_text_field",
    capabilities: { adminFilterable: { enabled: true } }
  }) { userErrors { message } }
}`;

const ENABLE_LISTING_ID_FILTER = `mutation EnableEtsyListingIdFilter {
  metafieldDefinitionUpdate(definition: {
    namespace: "custom",
    key: "etsy_listing_id",
    ownerType: PRODUCT,
    capabilities: { adminFilterable: { enabled: true } }
  }) { userErrors { message } }
}`;

const CREATE_LISTING_URL_DEFINITION = `mutation CreateEtsyListingUrlDefinition {
  metafieldDefinitionCreate(definition: {
    name: "Etsy Listing URL",
    namespace: "custom",
    key: "etsy_listing_url",
    ownerType: PRODUCT,
    type: "single_line_text_field"
  }) { userErrors { message } }
}`;

const CREATE_VARIANT_PRODUCT_ID_DEFINITION = `mutation CreateEtsyVariantProductIdDefinition {
  metafieldDefinitionCreate(definition: {
    name: "Etsy Variant Product ID",
    namespace: "custom",
    key: "etsy_product_id",
    ownerType: PRODUCTVARIANT,
    type: "single_line_text_field"
  }) { userErrors { message } }
}`;

const PRODUCT_QUERY = `query ProductByEtsyListing($query: String!, $cursor: String) {
  products(first: 100, query: $query, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      tags
      listingIdMetafield: metafield(namespace: "custom", key: "etsy_listing_id") { value }
      listingUrlMetafield: metafield(namespace: "custom", key: "etsy_listing_url") { value }
      variants(first: 100) {
        nodes {
          id
          sku
          etsyProductIdMetafield: metafield(namespace: "custom", key: "etsy_product_id") { value }
        }
      }
    }
  }
}`;

interface FilterableDefinition {
  readonly type: { readonly name: string };
  readonly capabilities: { readonly adminFilterable: { readonly enabled: boolean; readonly status: string } };
}

interface TypedDefinition {
  readonly type: { readonly name: string };
}

interface DefinitionResponse {
  readonly listingId: FilterableDefinition | null;
  readonly listingUrl: TypedDefinition | null;
  readonly variantProductId: TypedDefinition | null;
}

export interface EtsyListingMatch {
  readonly listingId: string;
  readonly productId: string;
  readonly title: string;
  readonly adminUrl: string;
  readonly matchedBy: "etsy_listing_id" | "etsy_listing_url" | "etsy_product_id" | "tag" | "sku";
}

export type EtsyListingStatus =
  | "available"
  | "existing"
  | "processing"
  | "queue_cleared"
  | "crawled_pending_sync"
  | "reconciliation_required";

export interface EtsyListingPreflight {
  readonly listingId: string;
  readonly variantProductIds: readonly string[];
  readonly databaseStatus: string | null;
  readonly jobId: string | null;
  readonly status: EtsyListingStatus;
  readonly hasExistingProduct: boolean;
  readonly recoveredStaleRegistry: boolean;
  readonly activeSeoJobIds: readonly string[];
}

export interface EtsyListingPreflightResult {
  readonly ready: boolean;
  readonly matches: readonly EtsyListingMatch[];
  readonly listings: readonly EtsyListingPreflight[];
  readonly allowedListingIds: readonly string[];
}

interface ListingInput {
  readonly listingId: string;
  readonly variantProductIds: readonly string[];
  readonly pipelineStatus: string | null;
  readonly databaseStatus: string | null;
  readonly jobId: string | null;
  readonly isSyncedInDb: boolean;
  readonly isActiveInSeo: boolean;
  readonly recoveredStaleRegistry: boolean;
  readonly shopifyProductIds: readonly string[];
  readonly activeSeoJobIds: readonly string[];
}

function isEtsyId(value: unknown): value is string {
  return typeof value === "string" && /^\d{6,20}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeListingInputs(
  payload: Record<string, unknown>,
  listingIds: readonly string[],
): ListingInput[] {
  if (payload.listings === undefined) {
    return listingIds.map((listingId) => ({
      listingId,
      variantProductIds: [],
      pipelineStatus: null,
      databaseStatus: null,
      jobId: null,
      isSyncedInDb: false,
      isActiveInSeo: false,
      recoveredStaleRegistry: false,
      shopifyProductIds: [],
      activeSeoJobIds: [],
    }));
  }
  if (!Array.isArray(payload.listings) || payload.listings.length === 0 || payload.listings.length > 200) {
    throw new GatewayError("Provide valid Etsy listing entries.", "SHOPIFY_INVALID_INPUT", 400);
  }
  const byListingId = new Map<string, ListingInput>();
  for (const rawItem of payload.listings) {
    if (!isRecord(rawItem) || !isEtsyId(rawItem.listingId)) {
      throw new GatewayError("Provide valid Etsy listing entries.", "SHOPIFY_INVALID_INPUT", 400);
    }
    const listingId = rawItem.listingId;
    const variantProductIds = Array.isArray(rawItem.variantProductIds)
      ? [...new Set(rawItem.variantProductIds.filter(isEtsyId))]
      : [];
    const shopifyProductIds = Array.isArray(rawItem.shopifyProductIds)
      ? rawItem.shopifyProductIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const activeSeoJobIds = Array.isArray(rawItem.activeSeoJobIds)
      ? rawItem.activeSeoJobIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    byListingId.set(listingId, {
      listingId,
      variantProductIds,
      pipelineStatus: typeof rawItem.status === "string" ? rawItem.status : null,
      databaseStatus: typeof rawItem.databaseStatus === "string" ? rawItem.databaseStatus : null,
      jobId: typeof rawItem.jobId === "string" ? rawItem.jobId : null,
      isSyncedInDb: rawItem.isSyncedInDb === true || shopifyProductIds.length > 0,
      isActiveInSeo: rawItem.isActiveInSeo === true || activeSeoJobIds.length > 0,
      recoveredStaleRegistry: rawItem.recoveredStaleRegistry === true,
      shopifyProductIds,
      activeSeoJobIds,
    });
  }
  if (listingIds.some((listingId) => !byListingId.has(listingId))) {
    throw new GatewayError("Etsy listing metadata does not cover every input listingId.", "SHOPIFY_INVALID_INPUT", 400);
  }
  return listingIds.map((listingId) => {
    const resolved = byListingId.get(listingId);
    if (!resolved) {
      throw new GatewayError("Etsy listing metadata does not cover every input listingId.", "SHOPIFY_INVALID_INPUT", 400);
    }
    return resolved;
  });
}

async function runDefinitionMutation(
  store: StoreConfig,
  client: Pick<ShopifyGraphqlClient, "query">,
  mutation: string,
  field: "metafieldDefinitionCreate" | "metafieldDefinitionUpdate",
  fallbackMessage: string,
  requestId?: string,
): Promise<void> {
  const response = await client.query<Record<string, { readonly userErrors: readonly { readonly message: string }[] }>>(
    store,
    mutation,
    undefined,
    { requestId, isWrite: true },
  );
  const errors = response[field]?.userErrors;
  if (!Array.isArray(errors) || errors.length > 0) {
    throw new GatewayError(
      errors?.map((error) => error.message).join("; ") || fallbackMessage,
      "SHOPIFY_USER_ERROR",
      409,
    );
  }
}

async function ensureEtsyDefinitions(
  store: StoreConfig,
  client: Pick<ShopifyGraphqlClient, "query">,
  requestId?: string,
): Promise<DefinitionResponse> {
  let definitions = await client.query<DefinitionResponse>(store, DEFINITION_QUERY);

  if (definitions.listingId && definitions.listingId.type.name !== "single_line_text_field") {
    throw new GatewayError(
      `custom.etsy_listing_id has incompatible metafield type ${definitions.listingId.type.name}.`,
      "SHOPIFY_USER_ERROR",
      409,
    );
  }
  if (!definitions.listingId) {
    await runDefinitionMutation(
      store,
      client,
      CREATE_LISTING_ID_DEFINITION,
      "metafieldDefinitionCreate",
      "Cannot create custom.etsy_listing_id metafield definition.",
      requestId,
    );
  } else if (!definitions.listingId.capabilities.adminFilterable.enabled) {
    await runDefinitionMutation(
      store,
      client,
      ENABLE_LISTING_ID_FILTER,
      "metafieldDefinitionUpdate",
      "Cannot enable custom.etsy_listing_id filtering.",
      requestId,
    );
  }

  if (
    definitions.listingUrl &&
    definitions.listingUrl.type.name !== "single_line_text_field" &&
    definitions.listingUrl.type.name !== "url"
  ) {
    throw new GatewayError(
      `custom.etsy_listing_url has incompatible metafield type ${definitions.listingUrl.type.name}.`,
      "SHOPIFY_USER_ERROR",
      409,
    );
  }
  if (!definitions.listingUrl) {
    await runDefinitionMutation(
      store,
      client,
      CREATE_LISTING_URL_DEFINITION,
      "metafieldDefinitionCreate",
      "Cannot create custom.etsy_listing_url metafield definition.",
      requestId,
    );
  }

  if (definitions.variantProductId && definitions.variantProductId.type.name !== "single_line_text_field") {
    throw new GatewayError(
      `custom.etsy_product_id has incompatible metafield type ${definitions.variantProductId.type.name}.`,
      "SHOPIFY_USER_ERROR",
      409,
    );
  }
  if (!definitions.variantProductId) {
    await runDefinitionMutation(
      store,
      client,
      CREATE_VARIANT_PRODUCT_ID_DEFINITION,
      "metafieldDefinitionCreate",
      "Cannot create custom.etsy_product_id metafield definition.",
      requestId,
    );
  }

  if (!definitions.listingId?.capabilities.adminFilterable.enabled) {
    definitions = await client.query<DefinitionResponse>(store, DEFINITION_QUERY);
  }
  return definitions;
}

interface ProductVariantNode {
  readonly id: string;
  readonly sku: string | null;
  readonly etsyProductIdMetafield: { readonly value: string } | null;
}

interface ProductNode {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly tags: readonly string[];
  readonly listingIdMetafield: { readonly value: string } | null;
  readonly listingUrlMetafield: { readonly value: string } | null;
  readonly variants: { readonly nodes: readonly ProductVariantNode[] };
}

function matchProductNodeToListing(
  product: ProductNode,
  listingId: string,
  variantProductIds: ReadonlySet<string>,
): EtsyListingMatch["matchedBy"] | null {
  if (product.listingIdMetafield?.value.trim() === listingId) {
    return "etsy_listing_id";
  }
  const listingUrlValue = product.listingUrlMetafield?.value.trim() ?? "";
  if (listingUrlValue) {
    const listingUrlRegex = new RegExp(`(?:^|/listing/)${listingId}(?:[/?#]|$)`, "i");
    if (listingUrlRegex.test(listingUrlValue)) {
      return "etsy_listing_url";
    }
  }
  if (product.tags.some((tag) => tag.trim().toLowerCase() === `ffp-source:etsy:${listingId}`)) {
    return "tag";
  }
  for (const variant of product.variants.nodes) {
    const variantProductId = variant.etsyProductIdMetafield?.value.trim() ?? "";
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

export async function executeEtsyListingPreflight(
  store: StoreConfig,
  client: Pick<ShopifyGraphqlClient, "query">,
  payload: unknown,
  mode: "preview" | "apply",
  requestId?: string,
): Promise<EtsyListingPreflightResult> {
  if (mode !== "apply") {
    throw new GatewayError("Etsy listing preflight requires apply mode.", "SHOPIFY_INVALID_INPUT", 400);
  }
  const payloadRecord = isRecord(payload) ? payload : {};
  const rawListingIds = payloadRecord.listingIds;
  if (!Array.isArray(rawListingIds) || rawListingIds.length === 0 || rawListingIds.length > 200 || !rawListingIds.every(isEtsyId)) {
    throw new GatewayError("Provide 1 to 200 normalized Etsy listing IDs.", "SHOPIFY_INVALID_INPUT", 400);
  }
  const listingIds = [...new Set(rawListingIds)];
  const listings = normalizeListingInputs(payloadRecord, listingIds);

  const definitions = await ensureEtsyDefinitions(store, client, requestId);
  const filterStatus = definitions.listingId?.capabilities.adminFilterable.status;
  if (filterStatus === "IN_PROGRESS") {
    return { ready: false, matches: [], listings: [], allowedListingIds: [] };
  }
  if (filterStatus !== "FILTERABLE") {
    throw new GatewayError("custom.etsy_listing_id is not searchable on Shopify.", "SHOPIFY_USER_ERROR", 409);
  }

  type ProductResponse = { readonly products: { readonly nodes: readonly ProductNode[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null } } };
  async function queryProducts(query: string): Promise<readonly ProductNode[]> {
    const nodes: ProductNode[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const response: ProductResponse = await client.query<ProductResponse>(store, PRODUCT_QUERY, { query, cursor });
      const page = response?.products;
      if (!page || !Array.isArray(page.nodes) || typeof page.pageInfo?.hasNextPage !== "boolean") {
        throw new GatewayError("Shopify returned an unreadable products response during Etsy preflight.", "SHOPIFY_NETWORK_ERROR", 502);
      }
      nodes.push(...page.nodes);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      if (page.pageInfo.hasNextPage && (!cursor || cursors.has(cursor) || cursors.size >= 1000)) {
        throw new GatewayError("Shopify pagination did not complete during Etsy preflight.", "SHOPIFY_NETWORK_ERROR", 502);
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return nodes;
  }

  const matches: EtsyListingMatch[] = [];
  const matchedKeys = new Set<string>();
  function recordMatch(listingId: string, product: ProductNode, matchedBy: EtsyListingMatch["matchedBy"]): void {
    const key = `${listingId}\0${product.id}`;
    if (matchedKeys.has(key)) return;
    matchedKeys.add(key);
    matches.push({
      listingId,
      productId: product.id,
      title: product.title,
      adminUrl: `https://${store.shopDomain}/admin/products/${product.id.split("/").at(-1)}`,
      matchedBy,
    });
  }

  const listingResults: Array<EtsyListingPreflight | undefined> = new Array(listings.length);
  let nextIndex = 0;

  async function checkNext(): Promise<void> {
    while (nextIndex < listings.length) {
      const index = nextIndex++;
      const listing = listings[index];
      if (!listing) continue;
      const variantIdSet = new Set(listing.variantProductIds);
      let hasExistingProduct = false;

      const primaryNodes = await queryProducts(`metafields.custom.etsy_listing_id:"${listing.listingId}"`);
      for (const candidate of primaryNodes) {
        const matchedBy = matchProductNodeToListing(candidate, listing.listingId, variantIdSet);
        if (matchedBy) {
          hasExistingProduct = true;
          recordMatch(listing.listingId, candidate, matchedBy);
        }
      }

      if (!hasExistingProduct) {
        const fallbackClauses = [
          `tag:"ffp-source:etsy:${listing.listingId}"`,
          `sku:ETSY-${listing.listingId}*`,
          `"${listing.listingId}"`,
          ...listing.variantProductIds.slice(0, 10).map((vpId) => `sku:ETSY-${vpId}`),
        ];
        const fallbackNodes = await queryProducts(`(${fallbackClauses.join(" OR ")})`);
        for (const candidate of fallbackNodes) {
          const matchedBy = matchProductNodeToListing(candidate, listing.listingId, variantIdSet);
          if (matchedBy) {
            hasExistingProduct = true;
            recordMatch(listing.listingId, candidate, matchedBy);
          }
        }
      }

      let status: EtsyListingStatus = "available";
      if (hasExistingProduct) {
        status = "existing";
      } else if (
        listing.isActiveInSeo ||
        listing.pipelineStatus === "processing" ||
        ["queued", "leased", "running", "cancelling"].includes(listing.databaseStatus ?? "")
      ) {
        status = "processing";
      } else if (listing.pipelineStatus === "crawled_pending_sync" || listing.databaseStatus === "crawled") {
        status = "crawled_pending_sync";
      } else if (
        listing.pipelineStatus === "reconciliation_required" ||
        ((listing.isSyncedInDb || listing.databaseStatus === "synced") && !hasExistingProduct)
      ) {
        status = "reconciliation_required";
      } else if (listing.pipelineStatus === "queue_cleared" || listing.databaseStatus === "queue_cleared") {
        status = "queue_cleared";
      }

      listingResults[index] = {
        listingId: listing.listingId,
        variantProductIds: listing.variantProductIds,
        databaseStatus: listing.databaseStatus,
        jobId: listing.jobId,
        status,
        hasExistingProduct,
        recoveredStaleRegistry: listing.recoveredStaleRegistry,
        activeSeoJobIds: listing.activeSeoJobIds,
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, listings.length) }, () => checkNext()));
  const resolvedListings = listingResults.filter((item): item is EtsyListingPreflight => item !== undefined);
  return {
    ready: true,
    matches,
    listings: resolvedListings,
    allowedListingIds: resolvedListings
      .filter((item) => item.status === "available" || item.status === "queue_cleared")
      .map((item) => item.listingId),
  };
}
