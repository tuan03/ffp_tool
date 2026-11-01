import { executeChunkedWrite } from "../chunked-write";
import { GatewayError, mapUserErrorsToGatewayError, type MutationUserErrorItem } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

export const METAFIELDS_SET_MUTATION = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        type
        value
        ownerType
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAFIELD_DEFINITION_QUERY = `
  query MetafieldDefinition($identifier: MetafieldDefinitionIdentifierInput!) {
    metafieldDefinition(identifier: $identifier) {
      id
      namespace
      key
      type {
        name
      }
      capabilities {
        adminFilterable {
          enabled
          status
        }
      }
    }
  }
`;

const METAFIELD_DEFINITION_CREATE_MUTATION = `
  mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
        type {
          name
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const METAFIELD_DEFINITION_UPDATE_MUTATION = `
  mutation MetafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

type ManagedMetafieldOwnerType = "PRODUCT" | "PRODUCTVARIANT";

interface ManagedMetafieldDefinition {
  readonly ownerType: ManagedMetafieldOwnerType;
  readonly namespace: "custom";
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly compatibleTypes?: readonly string[];
  readonly adminFilterable?: boolean;
  readonly pin?: boolean;
}

const MANAGED_PRODUCT_METAFIELD_DEFINITIONS: readonly ManagedMetafieldDefinition[] = [
  {
    ownerType: "PRODUCT",
    namespace: "custom",
    key: "aeo_suite_html",
    name: "AEO Suite (AI Search & Overview Optimization)",
    description: "HTML summary and FAQ content generated and approved by FFP SEO Review.",
    type: "multi_line_text_field",
    pin: true,
  },
  {
    ownerType: "PRODUCT",
    namespace: "custom",
    key: "aeo_json_ld",
    name: "Schema.org JSON-LD (@graph: Product & FAQPage)",
    description: "Validated Schema.org JSON-LD containing Product and FAQPage nodes.",
    type: "json",
    pin: true,
  },
  {
    ownerType: "PRODUCT",
    namespace: "custom",
    key: "etsy_listing_id",
    name: "Etsy Listing ID",
    description: "Source Etsy listing identifier synced by FFP.",
    type: "single_line_text_field",
    adminFilterable: true,
    pin: true,
  },
  {
    ownerType: "PRODUCT",
    namespace: "custom",
    key: "etsy_listing_url",
    name: "Etsy Listing URL",
    description: "Canonical Etsy listing URL synced by FFP.",
    type: "single_line_text_field",
    compatibleTypes: ["url"],
    pin: true,
  },
  {
    ownerType: "PRODUCTVARIANT",
    namespace: "custom",
    key: "etsy_product_id",
    name: "Etsy Variant Product ID",
    description: "Source Etsy inventory offering/product identifier synced by FFP.",
    type: "single_line_text_field",
  },
] as const;

interface MetafieldDefinitionNode {
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly type: { readonly name: string };
  readonly capabilities?: {
    readonly adminFilterable?: {
      readonly enabled: boolean;
      readonly status?: string;
    };
  };
}

interface MetafieldDefinitionQueryResponse {
  readonly metafieldDefinition: MetafieldDefinitionNode | null;
}

interface MetafieldDefinitionCreateResponse {
  readonly metafieldDefinitionCreate: {
    readonly createdDefinition: MetafieldDefinitionNode | null;
    readonly userErrors: readonly (MutationUserErrorItem & { readonly code?: string })[];
  };
}

interface MetafieldDefinitionUpdateResponse {
  readonly metafieldDefinitionUpdate: {
    readonly updatedDefinition: { readonly id: string } | null;
    readonly userErrors: readonly (MutationUserErrorItem & { readonly code?: string })[];
  };
}

const definitionEnsurePromises = new Map<string, Promise<string>>();

function assertDefinitionType(
  definition: MetafieldDefinitionNode,
  expected: ManagedMetafieldDefinition,
): string {
  const actualType = definition.type.name;
  const allowed = [expected.type, ...(expected.compatibleTypes ?? [])];
  if (!allowed.includes(actualType)) {
    throw new GatewayError(
      `Metafield definition ${expected.namespace}.${expected.key} uses type ${actualType}; expected ${expected.type}`,
      "SHOPIFY_USER_ERROR",
      400,
    );
  }
  return actualType;
}

async function loadMetafieldDefinition(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  definition: ManagedMetafieldDefinition,
): Promise<MetafieldDefinitionNode | null> {
  const response = await client.query<MetafieldDefinitionQueryResponse>(
    store,
    METAFIELD_DEFINITION_QUERY,
    {
      identifier: {
        ownerType: definition.ownerType,
        namespace: definition.namespace,
        key: definition.key,
      },
    },
  );
  return response.metafieldDefinition;
}

async function ensureAdminFilterableCapability(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  definition: ManagedMetafieldDefinition,
  existing: MetafieldDefinitionNode,
  requestId?: string,
): Promise<void> {
  if (!definition.adminFilterable) return;
  if (existing.capabilities?.adminFilterable?.enabled === true) return;
  const response = await client.query<MetafieldDefinitionUpdateResponse>(
    store,
    METAFIELD_DEFINITION_UPDATE_MUTATION,
    {
      definition: {
        ownerType: definition.ownerType,
        namespace: definition.namespace,
        key: definition.key,
        capabilities: {
          adminFilterable: { enabled: true },
        },
      },
    },
    { isWrite: true, requestId: requestId ? `${requestId}:definition-filter:${definition.key}` : undefined },
  );
  if (response.metafieldDefinitionUpdate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(response.metafieldDefinitionUpdate.userErrors);
  }
}

async function ensureMetafieldDefinition(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  definition: ManagedMetafieldDefinition,
  requestId?: string,
): Promise<string> {
  const ensureKey = `${store.shopDomain}:${definition.ownerType}:${definition.namespace}:${definition.key}:${definition.type}`;
  const existingPromise = definitionEnsurePromises.get(ensureKey);
  if (existingPromise) return existingPromise;

  const ensurePromise = (async (): Promise<string> => {
    const existing = await loadMetafieldDefinition(store, client, definition);
    if (existing) {
      const resolvedType = assertDefinitionType(existing, definition);
      await ensureAdminFilterableCapability(store, client, definition, existing, requestId);
      return resolvedType;
    }

    const createDefinitionInput: Record<string, unknown> = {
      ownerType: definition.ownerType,
      namespace: definition.namespace,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      type: definition.type,
      ...(definition.pin ? { pin: true } : {}),
      ...(definition.adminFilterable ? { capabilities: { adminFilterable: { enabled: true } } } : {}),
    };

    const response = await client.query<MetafieldDefinitionCreateResponse>(
      store,
      METAFIELD_DEFINITION_CREATE_MUTATION,
      {
        definition: createDefinitionInput,
      },
      { isWrite: true, requestId: requestId ? `${requestId}:definition:${definition.key}` : undefined },
    );
    const created = response.metafieldDefinitionCreate.createdDefinition;
    if (created) {
      return assertDefinitionType(created, definition);
    }

    // Another concurrent worker can create the same store definition between
    // our read and write. Re-read before treating the mutation error as fatal.
    const racedDefinition = await loadMetafieldDefinition(store, client, definition);
    if (racedDefinition) {
      const resolvedType = assertDefinitionType(racedDefinition, definition);
      await ensureAdminFilterableCapability(store, client, definition, racedDefinition, requestId);
      return resolvedType;
    }
    throw mapUserErrorsToGatewayError(response.metafieldDefinitionCreate.userErrors);
  })();

  definitionEnsurePromises.set(ensureKey, ensurePromise);
  try {
    return await ensurePromise;
  } catch (error: unknown) {
    definitionEnsurePromises.delete(ensureKey);
    throw error;
  }
}

export interface MetafieldSummary {
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly type: string;
  readonly value: string;
  readonly ownerType?: string;
}

function resolveOwnerTypeFromGid(ownerId: string): ManagedMetafieldOwnerType | null {
  if (ownerId.startsWith("gid://shopify/Product/")) return "PRODUCT";
  if (ownerId.startsWith("gid://shopify/ProductVariant/")) return "PRODUCTVARIANT";
  return null;
}

/** Shared by metafields.set and productUpdate; definitions remain scoped to the target store. */
export async function ensureManagedProductMetafieldDefinitions(input: {
  readonly store: StoreConfig;
  readonly client: ShopifyGraphqlClient;
  readonly metafields: readonly { readonly ownerId: string; readonly namespace?: string; readonly key?: string }[];
  readonly requestId?: string;
}): Promise<ReadonlyMap<string, string>> {
  const resolvedTypes = new Map<string, string>();
  const requiredDefinitions = MANAGED_PRODUCT_METAFIELD_DEFINITIONS.filter((definition) =>
    input.metafields.some(
      (field) =>
        resolveOwnerTypeFromGid(field.ownerId) === definition.ownerType &&
        field.namespace === definition.namespace &&
        field.key === definition.key,
    ),
  );
  for (const definition of requiredDefinitions) {
    const resolvedType = await ensureMetafieldDefinition(input.store, input.client, definition, input.requestId);
    resolvedTypes.set(`${definition.ownerType}:${definition.namespace}.${definition.key}`, resolvedType);
  }
  return resolvedTypes;
}

export interface MetafieldsSetResult {
  readonly success: boolean;
  readonly metafieldId?: string;
  readonly metafields: readonly MetafieldSummary[];
}

interface RawMetafieldNode {
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly type: string;
  readonly value: string;
  readonly ownerType?: string | null;
}

interface MetafieldsSetResponse {
  readonly metafieldsSet: {
    readonly metafields: readonly RawMetafieldNode[] | null;
    readonly userErrors: readonly MutationUserErrorItem[];
  };
}

interface NormalizedMetafieldItem {
  readonly ownerId: string;
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly type: string;
}

export function getMetafieldMaxBytes(type?: string): number {
  switch (type) {
    case "json":
      return 131072; // 128KB
    case "url":
    case "link":
    case "id":
      return 2048; // 2KB
    default:
      return 65536; // 64KB
  }
}

export async function executeMetafieldsSet(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<MetafieldsSetResult> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

  let rawItems: readonly Record<string, unknown>[];
  if (Array.isArray(p.metafields)) {
    rawItems = p.metafields as readonly Record<string, unknown>[];
  } else if (p.namespace !== undefined || p.key !== undefined || p.value !== undefined) {
    rawItems = [p];
  } else {
    throw new GatewayError("metafields array or metafield object is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (rawItems.length === 0) {
    throw new GatewayError("metafields array cannot be empty", "SHOPIFY_USER_ERROR", 400);
  }

  const fallbackOwnerId =
    typeof p.ownerId === "string" && p.ownerId.trim() !== ""
      ? p.ownerId.trim()
      : typeof p.productId === "string" && p.productId.trim() !== ""
      ? p.productId.trim()
      : "";

  const normalized: NormalizedMetafieldItem[] = rawItems.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new GatewayError(`Metafield at index ${index} must be an object`, "SHOPIFY_USER_ERROR", 400);
    }
    const ownerId =
      typeof item.ownerId === "string" && item.ownerId.trim() !== ""
        ? item.ownerId.trim()
        : typeof item.productId === "string" && item.productId.trim() !== ""
        ? item.productId.trim()
        : fallbackOwnerId;
    if (!ownerId) {
      throw new GatewayError(`ownerId (or productId) is required at index ${index}`, "SHOPIFY_USER_ERROR", 400);
    }
    const namespace = typeof item.namespace === "string" ? item.namespace.trim() : "";
    if (!namespace) {
      throw new GatewayError(`namespace is required at index ${index}`, "SHOPIFY_USER_ERROR", 400);
    }
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!key) {
      throw new GatewayError(`key is required at index ${index}`, "SHOPIFY_USER_ERROR", 400);
    }
    let valStr: string;
    if (typeof item.value === "string") {
      valStr = item.value;
    } else if (typeof item.value === "object" && item.value !== null) {
      valStr = JSON.stringify(item.value);
    } else if (item.value !== undefined && item.value !== null) {
      valStr = String(item.value);
    } else {
      throw new GatewayError(`value is required at index ${index}`, "SHOPIFY_USER_ERROR", 400);
    }

    const byteLength = Buffer.byteLength(valStr, "utf8");
    const type =
      typeof item.type === "string" && item.type.trim() !== ""
        ? item.type.trim()
        : "json";

    const maxBytes = getMetafieldMaxBytes(type);
    if (byteLength > maxBytes) {
      const limitDesc = maxBytes === 131072 ? "128KB" : `${maxBytes / 1024}KB`;
      throw new GatewayError(
        `Metafield value exceeds Shopify ${limitDesc} UTF-8 byte limit`,
        "SHOPIFY_INVALID_INPUT",
        400,
      );
    }

    return {
      ownerId,
      namespace,
      key,
      value: valStr,
      type,
    };
  });

  if (mode === "preview") {
    const previewMetafields: MetafieldSummary[] = normalized.map((item, index) => ({
      id: `gid://shopify/Metafield/preview-${index + 1}`,
      namespace: item.namespace,
      key: item.key,
      type: item.type,
      value: item.value,
    }));
    return {
      success: true,
      metafieldId: previewMetafields[0]?.id,
      metafields: previewMetafields,
    };
  }

  const resolvedDefinitionTypes = await ensureManagedProductMetafieldDefinitions({
    store,
    client,
    metafields: normalized,
    requestId,
  });
  const coercedItems: NormalizedMetafieldItem[] = normalized.map((item) => {
    const ownerType = resolveOwnerTypeFromGid(item.ownerId);
    const resolvedType = ownerType
      ? resolvedDefinitionTypes.get(`${ownerType}:${item.namespace}.${item.key}`)
      : undefined;
    return resolvedType && resolvedType !== item.type ? { ...item, type: resolvedType } : item;
  });

  const chunkedResult = await executeChunkedWrite<NormalizedMetafieldItem, MetafieldSummary[]>({
    items: coercedItems,
    chunkSize: 25,
    operationName: "metafields.set",
    executeChunk: async (chunk, chunkIndex) => {
      const chunkRequestId = requestId ? `${requestId}:mf:${chunkIndex}` : undefined;
      const metafieldInputs = chunk.map((m) => ({
        ownerId: m.ownerId,
        namespace: m.namespace,
        key: m.key,
        type: m.type,
        value: m.value,
      }));

      const raw = await client.query<MetafieldsSetResponse>(
        store,
        METAFIELDS_SET_MUTATION,
        { metafields: metafieldInputs },
        { isWrite: true, requestId: chunkRequestId },
      );

      if (raw.metafieldsSet.userErrors && raw.metafieldsSet.userErrors.length > 0) {
        throw mapUserErrorsToGatewayError(raw.metafieldsSet.userErrors);
      }

      const chunkMapped: MetafieldSummary[] = [];
      if (raw.metafieldsSet.metafields) {
        for (const node of raw.metafieldsSet.metafields) {
          chunkMapped.push({
            id: node.id,
            namespace: node.namespace,
            key: node.key,
            type: node.type,
            value: node.value,
            ownerType: node.ownerType ?? undefined,
          });
        }
      }
      return chunkMapped;
    },
    extractCompletedDetails: (completedResults) => {
      const allMapped = completedResults.flat();
      return {
        completedCount: allMapped.length,
        metafieldIds: allMapped.map((m) => m.id),
        metafieldKeys: allMapped.map((m) => `${m.namespace}.${m.key}`),
      };
    },
  });

  const mappedMetafields = chunkedResult.chunkResults.flat();

  return {
    success: true,
    metafieldId: mappedMetafields[0]?.id,
    metafields: mappedMetafields,
  };
}

export const METAFIELD_GET_QUERY = `
  query GetMetafieldNode($id: ID!, $namespace: String!, $key: String!) {
    node(id: $id) {
      id
      ... on HasMetafields {
        metafield(namespace: $namespace, key: $key) {
          id
          namespace
          key
          value
          type
        }
      }
    }
  }
`;

export interface MetafieldsGetPayload {
  readonly ownerId: string;
  readonly namespace?: string;
  readonly key?: string;
}

export interface MetafieldsGetData {
  readonly id?: string;
  readonly value: string | null;
  readonly namespace?: string;
  readonly key?: string;
  readonly type?: string;
}

interface RawMetafieldGetResponse {
  readonly node?: {
    readonly id: string;
    readonly metafield?: {
      readonly id: string;
      readonly namespace: string;
      readonly key: string;
      readonly value: string;
      readonly type: string;
    } | null;
  } | null;
}

export async function executeMetafieldsGet(
  client: ShopifyGraphqlClient,
  store: StoreConfig,
  payload: unknown,
  executionMode: "preview" | "apply",
): Promise<MetafieldsGetData> {
  const p = payload as Record<string, unknown> | null;
  const ownerId = typeof p?.ownerId === "string" ? p.ownerId.trim() : "";
  if (!ownerId) {
    throw new GatewayError("ownerId is required", "SHOPIFY_INVALID_INPUT", 400);
  }

  const namespace = typeof p?.namespace === "string" ? p.namespace.trim() : "";
  const key = typeof p?.key === "string" ? p.key.trim() : "";
  if (!namespace || !key) {
    throw new GatewayError("namespace and key are required", "SHOPIFY_INVALID_INPUT", 400);
  }

  if (executionMode === "preview") {
    return {
      id: "gid://shopify/Metafield/preview-1",
      value: null,
      namespace,
      key,
      type: "json",
    };
  }

  const raw = await client.query<RawMetafieldGetResponse>(
    store,
    METAFIELD_GET_QUERY,
    { id: ownerId, namespace, key },
    { isWrite: false },
  );

  const mf = raw?.node?.metafield;
  if (!mf) {
    return {
      id: undefined,
      value: null,
      namespace,
      key,
    };
  }

  return {
    id: mf.id,
    value: mf.value,
    namespace: mf.namespace,
    key: mf.key,
    type: mf.type,
  };
}

export const METAFIELDS_DELETE_MUTATION = `
  mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        ownerId
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface MetafieldIdentifier {
  readonly ownerId: string;
  readonly namespace: string;
  readonly key: string;
}

export interface MetafieldsDeletePayload {
  readonly id?: string;
  readonly ownerId?: string;
  readonly namespace?: string;
  readonly key?: string;
  readonly metafields?: readonly MetafieldIdentifier[];
}

export interface MetafieldsDeleteData {
  readonly success: boolean;
  readonly deletedMetafields: readonly MetafieldIdentifier[];
  readonly notFound: readonly MetafieldIdentifier[];
  readonly deletedId?: undefined;
}

interface RawMetafieldsDeleteResponse {
  readonly metafieldsDelete?: {
    readonly deletedMetafields?: readonly (MetafieldIdentifier | null)[] | null;
    readonly userErrors?: readonly MutationUserErrorItem[];
  } | null;
}

export async function executeMetafieldsDelete(
  client: ShopifyGraphqlClient,
  store: StoreConfig,
  payload: unknown,
  executionMode: "preview" | "apply",
  requestId?: string,
): Promise<MetafieldsDeleteData> {
  const p = payload as Record<string, unknown> | null;
  let rawIdentifiers: readonly Record<string, unknown>[];

  if (Array.isArray(p?.metafields)) {
    rawIdentifiers = p.metafields as readonly Record<string, unknown>[];
  } else if (p?.ownerId && p?.namespace && p?.key) {
    rawIdentifiers = [p];
  } else if (p?.id) {
    throw new GatewayError(
      "Shopify 2026-07 requires (ownerId, namespace, key) identifiers to delete metafields. Specifying 'id' alone is no longer supported.",
      "SHOPIFY_USER_ERROR",
      400,
    );
  } else {
    throw new GatewayError(
      "metafields array or (ownerId, namespace, key) identifier is required to delete metafields",
      "SHOPIFY_USER_ERROR",
      400,
    );
  }

  if (rawIdentifiers.length === 0) {
    throw new GatewayError("metafields array cannot be empty", "SHOPIFY_USER_ERROR", 400);
  }

  if (rawIdentifiers.length > 250) {
    throw new GatewayError(
      "metafields array exceeds Shopify limit of 250 identifiers per mutation",
      "SHOPIFY_USER_ERROR",
      400,
    );
  }

  const identifiers: MetafieldIdentifier[] = rawIdentifiers.map((item, idx) => {
    const ownerId = typeof item.ownerId === "string" ? item.ownerId.trim() : "";
    const namespace = typeof item.namespace === "string" ? item.namespace.trim() : "";
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!ownerId || !namespace || !key) {
      throw new GatewayError(
        `ownerId, namespace, and key are required for metafield identifier at index ${idx}`,
        "SHOPIFY_USER_ERROR",
        400,
      );
    }
    return { ownerId, namespace, key };
  });

  if (executionMode === "preview") {
    return {
      success: true,
      deletedMetafields: identifiers,
      notFound: [],
      deletedId: undefined,
    };
  }

  const raw = await client.query<RawMetafieldsDeleteResponse>(
    store,
    METAFIELDS_DELETE_MUTATION,
    { metafields: identifiers },
    { isWrite: true, requestId },
  );

  if (!raw?.metafieldsDelete) {
    throw new GatewayError("Shopify returned empty metafieldsDelete response", "SHOPIFY_USER_ERROR", 502);
  }

  if (raw.metafieldsDelete.userErrors && raw.metafieldsDelete.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.metafieldsDelete.userErrors);
  }

  const deletedMetafields: MetafieldIdentifier[] = [];
  const notFound: MetafieldIdentifier[] = [];

  const rawDeleted = raw.metafieldsDelete.deletedMetafields ?? [];
  for (let i = 0; i < identifiers.length; i++) {
    const item = rawDeleted[i];
    const requested = identifiers[i];
    if (item && item.ownerId && item.namespace && item.key) {
      deletedMetafields.push(item);
    } else {
      notFound.push(requested);
    }
  }

  return {
    success: true,
    deletedMetafields,
    notFound,
    deletedId: undefined,
  };
}
