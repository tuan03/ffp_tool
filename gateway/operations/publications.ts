import { GatewayError, mapUserErrorsToGatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

interface PublicationPage {
  readonly publications: {
    readonly nodes: readonly {
      readonly id: string;
      readonly name: string;
      readonly catalog?: { readonly __typename: string; readonly title?: string | null } | null;
    }[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string | null };
  };
}

interface TargetPublicationPage {
  readonly publications: {
    readonly nodes: readonly {
      readonly id: string;
      readonly catalog?: { readonly __typename: string; readonly title?: string | null } | null;
    }[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string | null };
  };
}

export interface ProductPublicationResult {
  readonly status: "completed" | "partial" | "failed";
  readonly channels: readonly { readonly id: string; readonly name: string; readonly published: boolean; readonly error?: string }[];
  readonly error?: string;
}

export interface ProductPublicationStatusResult {
  readonly publication: { readonly id: string; readonly name: string };
  readonly products: readonly {
    readonly id: string;
    readonly status: string;
    readonly published: boolean;
  }[];
}

export interface ProductSetPublicationResult extends ProductPublicationStatusResult {
  readonly requestedPublished: boolean;
  readonly changed: number;
  readonly unchanged: number;
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
const LIST_TARGET_PUBLICATIONS = `query PublicationChannels($after: String) {
  publications(first: 100, after: $after) {
    nodes { id catalog { __typename title } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const READ_PRODUCT_PUBLICATION_STATUS = `query PublicationProductStatus($ids: [ID!]!, $publicationId: ID!) {
  nodes(ids: $ids) {
    ... on Product { id status publishedOnPublication(publicationId: $publicationId) }
  }
}`;
const UPDATE_PUBLICATION_PRODUCTS = `mutation UpdatePublicationProducts($id: ID!, $input: PublicationUpdateInput!) {
  publicationUpdate(id: $id, input: $input) {
    publication { id }
    userErrors { field message }
  }
}`;

interface PublicationTargetPayload {
  readonly productIds: readonly string[];
  readonly publicationName: string;
}

interface PublicationProductNode {
  readonly id: string;
  readonly status: string;
  readonly publishedOnPublication: boolean;
}

function requirePublicationTargetPayload(payload: unknown): PublicationTargetPayload {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const publicationName = typeof record.publicationName === "string" ? record.publicationName.trim() : "";
  if (!publicationName) {
    throw new GatewayError("Publication name is required", "SHOPIFY_INVALID_INPUT", 400);
  }
  if (!Array.isArray(record.productIds) || record.productIds.length === 0 || record.productIds.length > 100) {
    throw new GatewayError("Between 1 and 100 product IDs are required", "SHOPIFY_INVALID_INPUT", 400);
  }
  const productIds = record.productIds.map(productId => {
    if (typeof productId !== "string" || !/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) {
      throw new GatewayError("Every product ID must be a valid Shopify product ID", "SHOPIFY_INVALID_INPUT", 400);
    }
    return productId;
  });
  if (new Set(productIds).size !== productIds.length) {
    throw new GatewayError("Product IDs must be unique", "SHOPIFY_INVALID_INPUT", 400);
  }
  return { productIds, publicationName };
}

async function resolvePublication(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  publicationName: string,
): Promise<{ readonly id: string; readonly name: string }> {
  const matches: { id: string; name: string }[] = [];
  const cursors = new Set<string>();
  let after: string | undefined;
  do {
    const page = await client.query<TargetPublicationPage>(store, LIST_TARGET_PUBLICATIONS, { after });
    for (const publication of page.publications.nodes) {
      const title = publication.catalog?.title?.trim();
      if (
        publication.catalog?.__typename === "AppCatalog" &&
        title &&
        title.localeCompare(publicationName, undefined, { sensitivity: "accent" }) === 0
      ) {
        matches.push({ id: publication.id, name: title });
      }
    }
    if (!page.publications.pageInfo.hasNextPage) break;
    const cursor = page.publications.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor)) {
      throw new GatewayError("Publication pagination is incomplete", "SHOPIFY_USER_ERROR", 502);
    }
    cursors.add(cursor);
    after = cursor;
  } while (true);

  if (matches.length !== 1) {
    throw new GatewayError(
      `Expected exactly one app publication named '${publicationName}', found ${matches.length}`,
      "SHOPIFY_NOT_FOUND",
      404,
    );
  }
  return matches[0];
}

async function readProductPublicationStatus(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  productIds: readonly string[],
  publicationId: string,
): Promise<readonly PublicationProductNode[]> {
  const response = await client.query<{ readonly nodes: readonly (PublicationProductNode | null)[] }>(
    store,
    READ_PRODUCT_PUBLICATION_STATUS,
    { ids: productIds, publicationId },
  );
  const products = response.nodes.filter((node): node is PublicationProductNode => node !== null);
  const productById = new Map(products.map(product => [product.id, product]));
  const missingIds = productIds.filter(productId => !productById.has(productId));
  if (missingIds.length > 0 || products.length !== productIds.length) {
    throw new GatewayError("One or more requested products were not found", "SHOPIFY_NOT_FOUND", 404);
  }
  return productIds.map(productId => productById.get(productId) as PublicationProductNode);
}

export async function executeProductPublicationStatus(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
): Promise<ProductPublicationStatusResult> {
  const target = requirePublicationTargetPayload(payload);
  const publication = await resolvePublication(store, client, target.publicationName);
  const products = await readProductPublicationStatus(store, client, target.productIds, publication.id);
  return {
    publication,
    products: products.map(product => ({
      id: product.id,
      status: product.status,
      published: product.publishedOnPublication,
    })),
  };
}

export function previewProductSetPublication(payload: unknown): {
  readonly preview: true;
  readonly productIds: readonly string[];
  readonly publicationName: string;
  readonly published: boolean;
} {
  const target = requirePublicationTargetPayload(payload);
  const record = payload as Record<string, unknown>;
  if (typeof record.published !== "boolean") {
    throw new GatewayError("Published must be a boolean", "SHOPIFY_INVALID_INPUT", 400);
  }
  return { preview: true, ...target, published: record.published };
}

export async function executeProductSetPublication(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
): Promise<ProductSetPublicationResult> {
  const preview = previewProductSetPublication(payload);
  const publication = await resolvePublication(store, client, preview.publicationName);
  const before = await readProductPublicationStatus(store, client, preview.productIds, publication.id);
  if (preview.published && before.some(product => product.status !== "ACTIVE")) {
    throw new GatewayError("Every product must be ACTIVE before publishing", "SHOPIFY_USER_ERROR", 400);
  }
  const changedIds = before
    .filter(product => product.publishedOnPublication !== preview.published)
    .map(product => product.id);

  if (changedIds.length > 0) {
    const input = preview.published
      ? { publishablesToAdd: changedIds }
      : { publishablesToRemove: changedIds };
    const response = await client.query<{
      readonly publicationUpdate: {
        readonly publication: { readonly id: string } | null;
        readonly userErrors: readonly { readonly field?: readonly string[]; readonly message: string }[];
      } | null;
    }>(store, UPDATE_PUBLICATION_PRODUCTS, { id: publication.id, input }, { isWrite: true });
    if (!response.publicationUpdate) {
      throw new GatewayError("Publication update returned no result", "SHOPIFY_UNKNOWN_WRITE_STATE", 502);
    }
    if (response.publicationUpdate.userErrors.length > 0) {
      throw mapUserErrorsToGatewayError(response.publicationUpdate.userErrors);
    }
  }

  const after = await readProductPublicationStatus(store, client, preview.productIds, publication.id);
  const mismatches = after.filter(product => product.publishedOnPublication !== preview.published);
  if (mismatches.length > 0) {
    throw new GatewayError(
      "Publication update could not be verified for every product",
      "SHOPIFY_PARTIAL_WRITE",
      502,
      undefined,
      undefined,
      undefined,
      false,
      { productIds: mismatches.map(product => product.id), publicationId: publication.id },
      true,
    );
  }

  return {
    publication,
    requestedPublished: preview.published,
    changed: changedIds.length,
    unchanged: preview.productIds.length - changedIds.length,
    products: after.map(product => ({
      id: product.id,
      status: product.status,
      published: product.publishedOnPublication,
    })),
  };
}

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
