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

const DEFINITION_QUERY = `query AmazonAsinDefinition {
  metafieldDefinition(identifier: { namespace: "custom", key: "amazon_asin", ownerType: PRODUCT }) {
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
const PRODUCT_QUERY = `query ProductByAmazonAsin($query: String!) {
  products(first: 5, query: $query) {
    nodes {
      id title handle
      metafield(namespace: "custom", key: "amazon_asin") { value }
    }
  }
}`;

interface DefinitionResponse {
  readonly metafieldDefinition: {
    readonly type: { readonly name: string };
    readonly capabilities: { readonly adminFilterable: { readonly enabled: boolean; readonly status: string } };
  } | null;
}

export interface AmazonAsinMatch {
  readonly asin: string;
  readonly productId: string;
  readonly title: string;
  readonly adminUrl: string;
}

export interface AmazonAsinPreflightResult {
  readonly ready: boolean;
  readonly matches: readonly AmazonAsinMatch[];
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
  const rawAsins = payload && typeof payload === "object" && "asins" in payload ? payload.asins : null;
  if (!Array.isArray(rawAsins) || rawAsins.length === 0 || rawAsins.length > 200 ||
      rawAsins.some((asin: unknown) => typeof asin !== "string" || !/^[A-Z0-9]{10}$/.test(asin))) {
    throw new GatewayError("Provide 1 to 200 normalized Amazon ASINs.", "SHOPIFY_INVALID_INPUT", 400);
  }
  const asins = [...new Set(rawAsins as string[])];

  let definition = (await client.query<DefinitionResponse>(store, DEFINITION_QUERY)).metafieldDefinition;
  if (definition && definition.type.name !== "single_line_text_field") {
    throw new GatewayError("custom.amazon_asin has an incompatible metafield type.", "SHOPIFY_USER_ERROR", 409);
  }
  if (!definition || !definition.capabilities.adminFilterable.enabled) {
    const mutation = definition ? ENABLE_FILTER : CREATE_DEFINITION;
    const field = definition ? "metafieldDefinitionUpdate" : "metafieldDefinitionCreate";
    const response = await client.query<Record<string, { userErrors: readonly { message: string }[] }>>(
      store, mutation, undefined, { requestId, isWrite: true },
    );
    const errors = response[field]?.userErrors;
    if (!Array.isArray(errors) || errors.length > 0) {
      throw new GatewayError(errors?.map((error) => error.message).join("; ") || "Cannot enable Amazon ASIN filtering.", "SHOPIFY_USER_ERROR", 409);
    }
    definition = (await client.query<DefinitionResponse>(store, DEFINITION_QUERY)).metafieldDefinition;
  }
  if (definition?.capabilities.adminFilterable.status !== "FILTERABLE") {
    if (definition?.capabilities.adminFilterable.status === "IN_PROGRESS") {
      return { ready: false, matches: [] };
    }
    throw new GatewayError("custom.amazon_asin is not searchable on Shopify.", "SHOPIFY_USER_ERROR", 409);
  }

  const matches: Array<AmazonAsinMatch | undefined> = new Array(asins.length);
  let nextIndex = 0;
  async function checkNext(): Promise<void> {
    while (nextIndex < asins.length) {
      const index = nextIndex++;
      const asin = asins[index];
      const query = `metafields.custom.amazon_asin:"${asin}"`;
      try {
        let response: {
          products: {
            nodes: readonly {
              id: string;
              title: string;
              metafield: { value: string } | null;
            }[];
          };
        };
        try {
          response = await client.query<{
            products: {
              nodes: readonly {
                id: string;
                title: string;
                metafield: { value: string } | null;
              }[];
            };
          }>(store, PRODUCT_QUERY, { query });
        } catch {
          // Retry once on transient failure
          await new Promise((resolve) => setTimeout(resolve, 500));
          response = await client.query<{
            products: {
              nodes: readonly {
                id: string;
                title: string;
                metafield: { value: string } | null;
              }[];
            };
          }>(store, PRODUCT_QUERY, { query });
        }
        const product = response.products.nodes.find((candidate) => candidate.metafield?.value === asin);
        if (product) {
          matches[index] = {
            asin,
            productId: product.id,
            title: product.title,
            adminUrl: `https://${store.shopDomain}/admin/products/${product.id.split("/").at(-1)}`,
          };
        }
      } catch (err: unknown) {
        console.warn(
          `[AmazonAsinPreflight] Warning: Failed to preflight ASIN ${asin} on Shopify:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, asins.length) }, () => checkNext()));
  return { ready: true, matches: matches.filter((match): match is AmazonAsinMatch => match !== undefined) };
}
