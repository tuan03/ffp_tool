import { GatewayError, mapUserErrorsToGatewayError, type MutationUserErrorItem } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { CollectionSummary, StoreConfig } from "../types";
import { mapCollectionNode, type RawCollectionNode } from "./collections";

const COLLECTION_CREATE_MUTATION = `
  mutation CollectionCreate($collection: CollectionCreateInput!) {
    collectionCreate(collection: $collection) {
      collection {
        id
        title
        handle
        descriptionHtml
        productsCount {
          count
        }
        updatedAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_UPDATE_MUTATION = `
  mutation CollectionUpdate($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection {
        id
        title
        handle
        descriptionHtml
        productsCount {
          count
        }
        updatedAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_DELETE_MUTATION = `
  mutation CollectionDelete($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) {
      deletedCollectionId
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_COLLECTION_SOURCES_QUERY = `
  query GetCollectionSources($id: ID!) {
    collection(id: $id) {
      id
      sources {
        __typename
        id
        title
      }
    }
  }
`;

const COLLECTION_UPDATE_MEMBERSHIP_MUTATION = `
  mutation CollectionUpdateMembership($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection {
        id
        productsCount {
          count
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function executeCollectionsCreate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ collection: CollectionSummary }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const collectionInput = (p.collection && typeof p.collection === "object" ? p.collection : undefined) as
    | Record<string, unknown>
    | undefined;

  if (!collectionInput) {
    throw new GatewayError("Collection payload is required", "SHOPIFY_USER_ERROR", 400);
  }

  const title = typeof collectionInput.title === "string" ? collectionInput.title.trim() : "";
  if (!title) {
    throw new GatewayError("Collection title is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    const now = new Date().toISOString();
    const handle =
      typeof collectionInput.handle === "string" && collectionInput.handle.trim() !== ""
        ? collectionInput.handle.trim()
        : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const previewCollection: CollectionSummary = {
      id: "gid://shopify/Collection/preview-new",
      title,
      handle,
      description: typeof collectionInput.description === "string" ? collectionInput.description : undefined,
      productsCount: 0,
      updatedAt: now,
    };
    return { collection: previewCollection };
  }

  const input: Record<string, unknown> = { title };
  if (typeof collectionInput.handle === "string" && collectionInput.handle.trim() !== "") {
    input.handle = collectionInput.handle.trim();
  }
  if (typeof collectionInput.description === "string") {
    input.descriptionHtml = collectionInput.description;
  }

  interface CollectionCreateResponse {
    readonly collectionCreate: {
      readonly collection: RawCollectionNode | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const raw = await client.query<CollectionCreateResponse>(
    store,
    COLLECTION_CREATE_MUTATION,
    { collection: input },
    { isWrite: true, requestId },
  );

  if (raw.collectionCreate.userErrors && raw.collectionCreate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.collectionCreate.userErrors);
  }

  if (!raw.collectionCreate.collection) {
    throw new GatewayError("Failed to create collection; missing collection data", "SHOPIFY_USER_ERROR", 400);
  }

  return { collection: mapCollectionNode(raw.collectionCreate.collection) };
}

export async function executeCollectionsUpdate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ collection: CollectionSummary }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    throw new GatewayError("Collection id is required", "SHOPIFY_USER_ERROR", 400);
  }

  const collectionPatch = (p.collection && typeof p.collection === "object" ? p.collection : undefined) as
    | Record<string, unknown>
    | undefined;
  if (!collectionPatch) {
    throw new GatewayError("Collection patch object is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    const now = new Date().toISOString();
    const previewCollection: CollectionSummary = {
      id,
      title: typeof collectionPatch.title === "string" ? collectionPatch.title : "Preview Collection",
      handle: typeof collectionPatch.handle === "string" ? collectionPatch.handle : "preview-collection",
      description: typeof collectionPatch.description === "string" ? collectionPatch.description : undefined,
      productsCount: 0,
      updatedAt: now,
    };
    return { collection: previewCollection };
  }

  const input: Record<string, unknown> = { id };
  if (typeof collectionPatch.title === "string") {
    input.title = collectionPatch.title;
  }
  if (typeof collectionPatch.handle === "string") {
    input.handle = collectionPatch.handle;
  }
  if (typeof collectionPatch.description === "string") {
    input.descriptionHtml = collectionPatch.description;
  }

  interface CollectionUpdateResponse {
    readonly collectionUpdate: {
      readonly collection: RawCollectionNode | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const raw = await client.query<CollectionUpdateResponse>(
    store,
    COLLECTION_UPDATE_MUTATION,
    { collection: input },
    { isWrite: true, requestId },
  );

  if (raw.collectionUpdate.userErrors && raw.collectionUpdate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.collectionUpdate.userErrors);
  }

  if (!raw.collectionUpdate.collection) {
    throw new GatewayError(`Failed to update collection ${id}`, "SHOPIFY_USER_ERROR", 400);
  }

  return { collection: mapCollectionNode(raw.collectionUpdate.collection) };
}

export async function executeCollectionsDelete(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ deletedCollectionId: string }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    throw new GatewayError("Collection id is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    return { deletedCollectionId: id };
  }

  interface CollectionDeleteResponse {
    readonly collectionDelete: {
      readonly deletedCollectionId: string | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const raw = await client.query<CollectionDeleteResponse>(
    store,
    COLLECTION_DELETE_MUTATION,
    { input: { id } },
    { isWrite: true, requestId },
  );

  if (raw.collectionDelete.userErrors && raw.collectionDelete.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.collectionDelete.userErrors);
  }

  return {
    deletedCollectionId: raw.collectionDelete.deletedCollectionId ?? id,
  };
}

export async function executeCollectionsUpdateMembership(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ collectionId: string; addedCount: number; removedCount: number }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const collectionId = typeof p.collectionId === "string" ? p.collectionId.trim() : "";
  if (!collectionId) {
    throw new GatewayError("collectionId is required", "SHOPIFY_USER_ERROR", 400);
  }

  const productIdsToAdd = Array.isArray(p.productIdsToAdd) ? (p.productIdsToAdd as string[]) : [];
  const productIdsToRemove = Array.isArray(p.productIdsToRemove) ? (p.productIdsToRemove as string[]) : [];

  if (mode === "preview") {
    return {
      collectionId,
      addedCount: productIdsToAdd.length,
      removedCount: productIdsToRemove.length,
    };
  }

  // 1. Query collection sources (Shopify 2026-07 multi-source collection model)
  interface CollectionSourcesResponse {
    readonly collection: {
      readonly id: string;
      readonly sources?: readonly {
        readonly __typename: string;
        readonly id: string;
        readonly title: string;
      }[] | null;
    } | null;
  }

  const sourcesRaw = await client.query<CollectionSourcesResponse>(
    store,
    GET_COLLECTION_SOURCES_QUERY,
    { id: collectionId },
    { isWrite: false },
  );

  if (!sourcesRaw.collection) {
    throw new GatewayError(`Collection not found: ${collectionId}`, "SHOPIFY_NOT_FOUND", 404);
  }

  // 2. Perform collectionUpdate with sourcesToUpdate (selectionsToAdd / selectionsToRemove)
  if (productIdsToAdd.length > 0 || productIdsToRemove.length > 0) {
    interface CollectionUpdateMembershipResponse {
      readonly collectionUpdate: {
        readonly collection: { readonly id: string; readonly productsCount?: { readonly count: number } } | null;
        readonly userErrors: readonly MutationUserErrorItem[];
      };
    }

    const sources = sourcesRaw.collection.sources || [];
    const conditionsSource =
      sources.find((s) => s.__typename === "CollectionConditionsSource");

    let collectionPatch: Record<string, unknown>;

    if (conditionsSource) {
      collectionPatch = {
        id: collectionId,
        sourcesToUpdate: [
          {
            condition: {
              id: conditionsSource.id,
              inclusion: {
                ...(productIdsToAdd.length > 0
                  ? { selectionsToAdd: productIdsToAdd.map((prodId) => ({ productId: prodId })) }
                  : {}),
                ...(productIdsToRemove.length > 0
                  ? { selectionsToRemove: productIdsToRemove.map((prodId) => ({ productId: prodId })) }
                  : {}),
              },
            },
          },
        ],
      };
    } else {
      collectionPatch = {
        id: collectionId,
        sourcesToCreate: [
          {
            source: {
              title: "Default Source",
              inclusion: {
                ...(productIdsToAdd.length > 0
                  ? { selections: productIdsToAdd.map((prodId) => ({ productId: prodId })) }
                  : {}),
              },
            },
          },
        ],
      };
    }

    const raw = await client.query<CollectionUpdateMembershipResponse>(
      store,
      COLLECTION_UPDATE_MEMBERSHIP_MUTATION,
      { collection: collectionPatch },
      { isWrite: true, requestId },
    );

    if (raw.collectionUpdate.userErrors && raw.collectionUpdate.userErrors.length > 0) {
      throw mapUserErrorsToGatewayError(raw.collectionUpdate.userErrors);
    }
  }

  return {
    collectionId,
    addedCount: productIdsToAdd.length,
    removedCount: productIdsToRemove.length,
  };
}
