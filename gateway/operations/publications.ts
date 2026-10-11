import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

interface PublicationPage {
  readonly publications: {
    readonly nodes: readonly { readonly id: string; readonly name: string; readonly catalog?: { readonly __typename: string } | null }[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string | null };
  };
}

export interface ProductPublicationResult {
  readonly status: "completed" | "partial" | "failed";
  readonly channels: readonly { readonly id: string; readonly name: string; readonly published: boolean; readonly error?: string }[];
  readonly error?: string;
}

const LIST = `query SalesChannels($after: String) {
  publications(first: 100, after: $after) { nodes { id name catalog { __typename } } pageInfo { hasNextPage endCursor } }
}`;
const READ = `query ChannelStatus($id: ID!, $publicationId: ID!) {
  product(id: $id) { status publishedOnPublication(publicationId: $publicationId) }
}`;
const PUBLISH = `mutation PublishChannel($id: ID!, $publicationId: ID!) {
  publishablePublish(id: $id, input: [{publicationId: $publicationId}]) { userErrors { message } }
}`;

function requireProductId(payload: unknown): string {
  const productId = typeof payload === "object" && payload !== null && "productId" in payload ? payload.productId : undefined;
  if (typeof productId !== "string" || !/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) {
    throw new GatewayError("Valid product ID is required", "SHOPIFY_INVALID_INPUT", 400);
  }
  return productId;
}

export function previewProductPublishAll(payload: unknown): { readonly preview: true; readonly productId: string } {
  return { preview: true, productId: requireProductId(payload) };
}

/** Discover current app/sales-channel publications, not market/B2B catalogs. */
export async function executeProductPublishAll(store: StoreConfig, client: ShopifyGraphqlClient, payload: unknown): Promise<ProductPublicationResult> {
  const productId = requireProductId(payload);
  const channels = new Map<string, PublicationPage["publications"]["nodes"][number]>();
  const cursors = new Set<string>();
  let after: string | undefined;
  do {
    const page = await client.query<PublicationPage>(store, LIST, { after });
    for (const channel of page.publications.nodes) {
      if (!channel.catalog || channel.catalog.__typename === "AppCatalog") channels.set(channel.id, channel);
    }
    if (!page.publications.pageInfo.hasNextPage) break;
    const cursor = page.publications.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor)) throw new GatewayError("Publication pagination is incomplete", "SHOPIFY_USER_ERROR", 502);
    cursors.add(cursor);
    after = cursor;
  } while (true);
  if (channels.size === 0) return { status: "failed", channels: [], error: "No accessible sales channels were found." };
  const outcomes: ProductPublicationResult["channels"][number][] = [];
  for (const channel of channels.values()) {
    try {
      const variables = { id: productId, publicationId: channel.id };
      const read = () => client.query<{ product: { status: string; publishedOnPublication: boolean } | null }>(store, READ, variables);
      const before = await read();
      if (!before.product || before.product.status !== "ACTIVE") throw new Error("Product must exist and be ACTIVE before publishing.");
      if (!before.product.publishedOnPublication) {
        const response = await client.query<{ publishablePublish: { userErrors: readonly { message: string }[] } | null }>(store, PUBLISH, variables, { isWrite: true });
        if (!response.publishablePublish || response.publishablePublish.userErrors.length) {
          throw new Error(response.publishablePublish?.userErrors.map(error => error.message).join("; ") || "Publication was not confirmed.");
        }
        if (!(await read()).product?.publishedOnPublication) throw new Error("Channel publication was not confirmed.");
      }
      outcomes.push({ id: channel.id, name: channel.name, published: true });
    } catch (error: unknown) {
      outcomes.push({ id: channel.id, name: channel.name, published: false,
        error: error instanceof GatewayError ? error.code : error instanceof Error ? error.message : "Publication failed." });
    }
  }
  return { status: outcomes.every(channel => channel.published) ? "completed" : "partial", channels: outcomes };
}
