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

export interface MetafieldSummary {
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly type: string;
  readonly value: string;
  readonly ownerType?: string;
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

  const normalized: NormalizedMetafieldItem[] = rawItems.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new GatewayError(`Metafield at index ${index} must be an object`, "SHOPIFY_USER_ERROR", 400);
    }
    const ownerId =
      typeof item.ownerId === "string" && item.ownerId.trim() !== ""
        ? item.ownerId.trim()
        : typeof item.productId === "string" && item.productId.trim() !== ""
        ? item.productId.trim()
        : "";
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
    if (typeof item.value !== "string") {
      throw new GatewayError(`value must be a string at index ${index}`, "SHOPIFY_USER_ERROR", 400);
    }
    const type =
      typeof item.type === "string" && item.type.trim() !== ""
        ? item.type.trim()
        : "json";

    return {
      ownerId,
      namespace,
      key,
      value: item.value,
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

  const metafieldInputs = normalized.map((m) => ({
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
    { isWrite: true, requestId },
  );

  if (raw.metafieldsSet.userErrors && raw.metafieldsSet.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.metafieldsSet.userErrors);
  }

  const mappedMetafields: MetafieldSummary[] = (raw.metafieldsSet.metafields ?? []).map((node) => ({
    id: node.id,
    namespace: node.namespace,
    key: node.key,
    type: node.type,
    value: node.value,
    ownerType: node.ownerType ?? undefined,
  }));

  return {
    success: true,
    metafieldId: mappedMetafields[0]?.id,
    metafields: mappedMetafields,
  };
}
