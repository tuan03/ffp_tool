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
  products(first: 5, query: $query) {
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

  const matches: Array<AmazonAsinMatch | undefined> = new Array(families.length);
  const familyResults: Array<AmazonAsinFamilyPreflight | undefined> = new Array(families.length);
  let nextIndex = 0;
  async function checkNext(): Promise<void> {
    while (nextIndex < families.length) {
      const index = nextIndex++;
      const family = families[index];
      const parentNodes = await queryProducts(`metafields.custom.amazon_parent_asin:"${family.parentAsin}"`);
      let product = parentNodes.find((candidate) => candidate.parentMetafield?.value === family.parentAsin);
      if (!product) {
        for (const asin of family.memberAsins) {
          const asinNodes = await queryProducts(`metafields.custom.amazon_asin:"${asin}"`);
          product = asinNodes.find((candidate) => candidate.metafield?.value === asin);
          if (product) break;
        }
      }

      let status: AmazonAsinFamilyStatus = "available";
      if (product) {
        status = "existing";
        matches[index] = {
          asin: family.inputAsins[0],
          parentAsin: family.parentAsin,
          productId: product.id,
          title: product.title,
          adminUrl: `https://${store.shopDomain}/admin/products/${product.id.split("/").at(-1)}`,
        };
      } else if (["queued", "leased", "running", "cancelling"].includes(family.databaseStatus ?? "")) {
        status = "processing";
      } else if (family.databaseStatus === "crawled") {
        status = "crawled_pending_sync";
      } else if (family.databaseStatus === "synced") {
        status = "reconciliation_required";
      }
      familyResults[index] = { ...family, status };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, families.length) }, () => checkNext()));
  const resolvedFamilies = familyResults.filter((family): family is AmazonAsinFamilyPreflight => family !== undefined);
  return {
    ready: true,
    matches: matches.filter((match): match is AmazonAsinMatch => match !== undefined),
    families: resolvedFamilies,
    allowedAsins: resolvedFamilies
      .filter((family) => family.status === "available")
      .flatMap((family) => family.inputAsins.slice(0, 1)),
  };
}
