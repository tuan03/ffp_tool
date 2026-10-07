/**
 * @deprecated EXTERNAL ARCHITECTURE DEBT:
 * Amazon ASIN preflight contains Amazon business domain logic.
 * A pure generic Shopify Gateway should not contain business-specific preflights.
 * Use generic products.list({ query: "..." }) or metafields.get instead.
 * Scheduled for migration to amazon-crawler / shopify-sync business modules.
 */

import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

const DEFINITION_QUERY = `query AmazonAsinDefinitions {
  asin: metafieldDefinition(identifier: { namespace: "custom", key: "amazon_asin", ownerType: PRODUCT }) {
    type { name }
    capabilities { adminFilterable { enabled status } }
  }
  parentAsin: metafieldDefinition(identifier: { namespace: "custom", key: "amazon_parent_asin", ownerType: PRODUCT }) {
    type { name }
    capabilities { adminFilterable { enabled status } }
  }
}`;
const CREATE_DEFINITION = `mutation CreateAmazonAsinDefinition {
  metafieldDefinitionCreate(definition: {
    name: "Amazon ASIN", namespace: "custom", key: "amazon_asin",
    ownerType: PRODUCT, type: "single_line_text_field",
    capabilities: { adminFilterable: { enabled: true } }
  }) { userErrors { message } }
}`;
const ENABLE_FILTER = `mutation EnableAmazonAsinFilter {
  metafieldDefinitionUpdate(definition: {
    namespace: "custom", key: "amazon_asin", ownerType: PRODUCT,
    capabilities: { adminFilterable: { enabled: true } }
  }) { userErrors { message } }
}`;
const CREATE_PARENT_DEFINITION = `mutation CreateAmazonParentAsinDefinition {
  metafieldDefinitionCreate(definition: {
    name: "Amazon Parent ASIN", namespace: "custom", key: "amazon_parent_asin",
    ownerType: PRODUCT, type: "single_line_text_field",
    capabilities: { adminFilterable: { enabled: true } }
  }) { userErrors { message } }
}`;
const ENABLE_PARENT_FILTER = `mutation EnableAmazonParentAsinFilter {
  metafieldDefinitionUpdate(definition: {
    namespace: "custom", key: "amazon_parent_asin", ownerType: PRODUCT,
    capabilities: { adminFilterable: { enabled: true } }
  }) { userErrors { message } }
}`;
const PRODUCT_QUERY = `query ProductByAmazonFamily($query: String!) {
  products(first: 200, query: $query) {
    nodes {
      id title handle
      metafield(namespace: "custom", key: "amazon_asin") { value }
      parentMetafield: metafield(namespace: "custom", key: "amazon_parent_asin") { value }
    }
  }
}`;

interface Definition {
  readonly type: { readonly name: string };
  readonly capabilities: { readonly adminFilterable: { readonly enabled: boolean; readonly status: string } };
}

interface DefinitionResponse {
  readonly asin: Definition | null;
  readonly parentAsin: Definition | null;
}

export interface AmazonAsinMatch {
  readonly asin: string;
  readonly parentAsin: string;
  readonly productId: string;
  readonly title: string;
  readonly adminUrl: string;
}

export type AmazonAsinFamilyStatus =
  | "available"
  | "existing"
  | "processing"
  | "crawled_pending_sync"
  | "reconciliation_required";

export interface AmazonAsinFamilyPreflight {
  readonly parentAsin: string;
  readonly inputAsins: readonly string[];
  readonly memberAsins: readonly string[];
  readonly isResolved: boolean;
  readonly databaseStatus: string | null;
  readonly jobId: string | null;
  readonly status: AmazonAsinFamilyStatus;
  readonly hasExistingFamilyProducts: boolean;
  readonly recoveredStaleRegistry: boolean;
  readonly hasSyncedFamilyMembers: boolean;
}

export interface AmazonAsinPreflightResult {
  readonly ready: boolean;
  readonly matches: readonly AmazonAsinMatch[];
  readonly families: readonly AmazonAsinFamilyPreflight[];
  readonly allowedAsins: readonly string[];
}

interface FamilyInput {
  readonly parentAsin: string;
  readonly inputAsins: readonly string[];
  readonly memberAsins: readonly string[];
  readonly isResolved: boolean;
  readonly databaseStatus: string | null;
  readonly jobId: string | null;
  readonly recoveredStaleRegistry: boolean;
  readonly hasSyncedFamilyMembers: boolean;
}

function normalizeFamilyInputs(payload: Record<string, unknown>, asins: readonly string[]): FamilyInput[] {
  if (payload.families === undefined) {
    return asins.map((asin) => ({
      parentAsin: asin,
      inputAsins: [asin],
      memberAsins: [asin],
      isResolved: false,
      databaseStatus: null,
      jobId: null,
      recoveredStaleRegistry: false,
      hasSyncedFamilyMembers: false,
    }));
  }
  if (!Array.isArray(payload.families) || payload.families.length === 0 || payload.families.length > 200) {
    throw new GatewayError("Provide valid Amazon family groups.", "SHOPIFY_INVALID_INPUT", 400);
  }
  const coveredAsins = new Set<string>();
  const families = payload.families.map((rawFamily): FamilyInput => {
    if (!rawFamily || typeof rawFamily !== "object") {
      throw new GatewayError("Provide valid Amazon family groups.", "SHOPIFY_INVALID_INPUT", 400);
    }
    const family = rawFamily as Record<string, unknown>;
    const parentAsin = family.parentAsin;
    const inputAsins = family.inputAsins;
    const memberAsins = family.memberAsins;
    if (typeof parentAsin !== "string" || !/^[A-Z0-9]{10}$/.test(parentAsin) ||
        !Array.isArray(inputAsins) || inputAsins.length === 0 ||
        inputAsins.some((asin) => typeof asin !== "string" || !/^[A-Z0-9]{10}$/.test(asin)) ||
        !Array.isArray(memberAsins) || memberAsins.some((asin) => typeof asin !== "string" || !/^[A-Z0-9]{10}$/.test(asin))) {
      throw new GatewayError("Provide valid Amazon family groups.", "SHOPIFY_INVALID_INPUT", 400);
    }
    for (const asin of inputAsins as string[]) coveredAsins.add(asin);
    return {
      parentAsin,
      inputAsins: [...new Set(inputAsins as string[])],
      memberAsins: [...new Set([parentAsin, ...(memberAsins as string[])])],
      isResolved: family.isResolved === true,
      databaseStatus: typeof family.databaseStatus === "string" ? family.databaseStatus : null,
      jobId: typeof family.jobId === "string" ? family.jobId : null,
      recoveredStaleRegistry: family.recoveredStaleRegistry === true,
      hasSyncedFamilyMembers: family.hasSyncedFamilyMembers === true,
    };
  });
  if (asins.some((asin) => !coveredAsins.has(asin))) {
    throw new GatewayError("Amazon family groups do not cover every input ASIN.", "SHOPIFY_INVALID_INPUT", 400);
  }
  return families;
}

async function updateDefinition(
  store: StoreConfig,
  client: Pick<ShopifyGraphqlClient, "query">,
  definition: Definition | null,
  key: "asin" | "parentAsin",
  requestId?: string,
): Promise<void> {
  if (definition && definition.type.name !== "single_line_text_field") {
    const metafieldName = key === "asin" ? "custom.amazon_asin" : "custom.amazon_parent_asin";
    throw new GatewayError(`${metafieldName} has an incompatible metafield type.`, "SHOPIFY_USER_ERROR", 409);
  }
  if (definition?.capabilities.adminFilterable.enabled) return;
  const mutation = key === "asin"
    ? (definition ? ENABLE_FILTER : CREATE_DEFINITION)
    : (definition ? ENABLE_PARENT_FILTER : CREATE_PARENT_DEFINITION);
  const field = definition ? "metafieldDefinitionUpdate" : "metafieldDefinitionCreate";
  const response = await client.query<Record<string, { userErrors: readonly { message: string }[] }>>(
    store,
    mutation,
    undefined,
    { requestId, isWrite: true },
  );
  const errors = response[field]?.userErrors;
  if (!Array.isArray(errors) || errors.length > 0) {
    throw new GatewayError(
      errors?.map((error) => error.message).join("; ") || "Cannot enable Amazon ASIN filtering.",
      "SHOPIFY_USER_ERROR",
      409,
    );
  }
}

export async function executeAmazonAsinPreflight(
  store: StoreConfig,
  client: Pick<ShopifyGraphqlClient, "query">,
  payload: unknown,
  mode: "preview" | "apply",
  requestId?: string,
): Promise<AmazonAsinPreflightResult> {
  if (mode !== "apply") {
    throw new GatewayError("Amazon ASIN preflight requires apply mode.", "SHOPIFY_INVALID_INPUT", 400);
  }
  const payloadRecord = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rawAsins = payloadRecord.asins;
  if (!Array.isArray(rawAsins) || rawAsins.length === 0 || rawAsins.length > 200 ||
      rawAsins.some((asin) => typeof asin !== "string" || !/^[A-Z0-9]{10}$/.test(asin))) {
    throw new GatewayError("Provide 1 to 200 normalized Amazon ASINs.", "SHOPIFY_INVALID_INPUT", 400);
  }
  const asins = [...new Set(rawAsins as string[])];
  const families = normalizeFamilyInputs(payloadRecord, asins);

  let definitions = await client.query<DefinitionResponse>(store, DEFINITION_QUERY);
  await updateDefinition(store, client, definitions.asin, "asin", requestId);
  await updateDefinition(store, client, definitions.parentAsin, "parentAsin", requestId);
  if (!definitions.asin?.capabilities.adminFilterable.enabled || !definitions.parentAsin?.capabilities.adminFilterable.enabled) {
    definitions = await client.query<DefinitionResponse>(store, DEFINITION_QUERY);
  }
  for (const [name, definition] of [
    ["custom.amazon_asin", definitions.asin],
    ["custom.amazon_parent_asin", definitions.parentAsin],
  ] as const) {
    if (definition?.capabilities.adminFilterable.status === "IN_PROGRESS") {
      return { ready: false, matches: [], families: [], allowedAsins: [] };
    }
    if (definition?.capabilities.adminFilterable.status !== "FILTERABLE") {
      throw new GatewayError(`${name} is not searchable on Shopify.`, "SHOPIFY_USER_ERROR", 409);
    }
  }

  type ProductNode = {
    readonly id: string;
    readonly title: string;
    readonly metafield: { readonly value: string } | null;
    readonly parentMetafield: { readonly value: string } | null;
  };
  type ProductResponse = { readonly products: { readonly nodes: readonly ProductNode[] } };
  async function queryProducts(query: string): Promise<readonly ProductNode[]> {
    try {
      return (await client.query<ProductResponse>(store, PRODUCT_QUERY, { query })).products.nodes;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return (await client.query<ProductResponse>(store, PRODUCT_QUERY, { query })).products.nodes;
    }
  }

  const matches: AmazonAsinMatch[] = [];
  const matchedProducts = new Set<string>();
  function addMatch(asin: string, parentAsin: string, product: ProductNode): void {
    if (!/^[A-Z0-9]{10}$/.test(asin)) return;
    const key = `${asin}\0${product.id}`;
    if (matchedProducts.has(key)) return;
    matchedProducts.add(key);
    matches.push({
      asin,
      parentAsin,
      productId: product.id,
      title: product.title,
      adminUrl: `https://${store.shopDomain}/admin/products/${product.id.split("/").at(-1)}`,
    });
  }
  const familyResults: Array<AmazonAsinFamilyPreflight | undefined> = new Array(families.length);
  let nextIndex = 0;
  async function checkNext(): Promise<void> {
    while (nextIndex < families.length) {
      const index = nextIndex++;
      const family = families[index];
      let exactProduct: ProductNode | undefined;
      let exactAsin: string | undefined;
      for (const asin of family.inputAsins) {
        const asinNodes = await queryProducts(`metafields.custom.amazon_asin:"${asin}"`);
        exactProduct = asinNodes.find((candidate) => candidate.metafield?.value === asin);
        if (exactProduct) {
          exactAsin = asin;
          break;
        }
      }
      const shopifyParentAsin = exactProduct?.parentMetafield?.value;
      const effectiveParentAsin = shopifyParentAsin && /^[A-Z0-9]{10}$/.test(shopifyParentAsin)
        ? shopifyParentAsin
        : family.parentAsin;
      const parentNodes = await queryProducts(`metafields.custom.amazon_parent_asin:"${effectiveParentAsin}"`);
      const hasExistingFamilyProducts = family.hasSyncedFamilyMembers || parentNodes.some(
        (candidate) => candidate.parentMetafield?.value === effectiveParentAsin,
      );

      for (const candidate of parentNodes) {
        if (candidate.parentMetafield?.value === effectiveParentAsin && candidate.metafield?.value) {
          addMatch(candidate.metafield.value, effectiveParentAsin, candidate);
        }
      }
      if (exactProduct && exactAsin) addMatch(exactAsin, effectiveParentAsin, exactProduct);

      let status: AmazonAsinFamilyStatus = "available";
      if (["queued", "leased", "running", "cancelling"].includes(family.databaseStatus ?? "")) {
        status = "processing";
      } else if (family.databaseStatus === "crawled") {
        status = "crawled_pending_sync";
      } else if (family.databaseStatus === "synced" && !exactProduct && !hasExistingFamilyProducts) {
        status = "reconciliation_required";
      }
      familyResults[index] = {
        ...family,
        parentAsin: effectiveParentAsin,
        status,
        hasExistingFamilyProducts: hasExistingFamilyProducts || exactProduct !== undefined,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, families.length) }, () => checkNext()));
  const resolvedFamilies = familyResults.filter((family): family is AmazonAsinFamilyPreflight => family !== undefined);
  return {
    ready: true,
    matches,
    families: resolvedFamilies,
    allowedAsins: resolvedFamilies
      .filter((family) => family.status === "available")
      .flatMap((family) => family.inputAsins.slice(0, 1)),
  };
}
