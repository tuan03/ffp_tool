import { GatewayError } from "./errors";
import { deterministicStringify, type IdempotencyStore, InMemoryIdempotencyStore } from "./idempotency";
import { executeCollectionsGet, executeCollectionsList } from "./operations/collections";
import {
  executeCollectionsCreate,
  executeCollectionsDelete,
  executeCollectionsUpdate,
  executeCollectionsUpdateMembership,
} from "./operations/collections-write";
import { executeConnectionTest } from "./operations/connection-test";
import { executeProductsGet, executeProductsList } from "./operations/products";
import {
  executeProductsBulkUpdate,
  executeProductsCreate,
  executeProductsDelete,
  executeProductsUpdate,
} from "./operations/products-write";
import {
  executeVariantsBulkUpdate,
  executeVariantsUpdate,
} from "./operations/variants-write";
import type { ShopifyGraphqlClient } from "./shopify-graphql-client";
import type { StoreRegistry } from "./store-registry";
import type { GatewayRequest, GatewayResponse, StoreConfig } from "./types";

const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "products.create",
  "products.update",
  "products.bulkUpdate",
  "products.delete",
  "variants.update",
  "variants.bulkUpdate",
  "collections.create",
  "collections.update",
  "collections.delete",
  "collections.updateMembership",
]);

export interface GatewayDispatcherOptions {
  readonly storeRegistry: StoreRegistry;
  readonly graphqlClient: ShopifyGraphqlClient;
  readonly idempotencyStore?: IdempotencyStore;
}

export class GatewayDispatcher {
  private readonly storeRegistry: StoreRegistry;
  private readonly graphqlClient: ShopifyGraphqlClient;
  private readonly idempotencyStore: IdempotencyStore;
  private readonly inFlightWrites = new Map<string, Promise<unknown>>();

  public constructor(options: GatewayDispatcherOptions) {
    this.storeRegistry = options.storeRegistry;
    this.graphqlClient = options.graphqlClient;
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
  }

  public async dispatch(request: GatewayRequest): Promise<GatewayResponse> {
    if (!request || typeof request !== "object") {
      throw new GatewayError("Invalid gateway request payload", "SHOPIFY_INVALID_INPUT", 400);
    }
    if (!request.storeId || request.storeId.trim() === "") {
      throw new GatewayError("storeId is required", "SHOPIFY_INVALID_INPUT", 400);
    }
    if (!request.operation || request.operation.trim() === "") {
      throw new GatewayError("operation is required", "SHOPIFY_INVALID_INPUT", 400);
    }

    const store = await this.storeRegistry.getStore(request.storeId);
    if (!store) {
      throw new GatewayError(`Store not found: ${request.storeId}`, "SHOPIFY_NOT_FOUND", 404);
    }

    const isWrite = WRITE_OPERATIONS.has(request.operation);
    const mode: "preview" | "apply" = request.mode === "preview" ? "preview" : "apply";
    const requestId = typeof request.requestId === "string" && request.requestId.trim() !== ""
      ? request.requestId.trim()
      : undefined;

    if (isWrite && requestId) {
      const idempotencyKey = `${store.storeId}:${request.operation}:${requestId}`;
      const payloadHash = deterministicStringify(request.payload);

      const cached = await this.idempotencyStore.get(idempotencyKey);
      if (cached) {
        if (cached.payloadHash !== payloadHash) {
          throw new GatewayError(
            `RequestId '${requestId}' has already been used with a different payload`,
            "SHOPIFY_USER_ERROR",
            409,
          );
        }
        return {
          storeId: request.storeId,
          operation: request.operation,
          success: true,
          data: cached.responseData,
        };
      }

      const inFlight = this.inFlightWrites.get(idempotencyKey);
      if (inFlight) {
        const data = await inFlight;
        return {
          storeId: request.storeId,
          operation: request.operation,
          success: true,
          data,
        };
      }

      const execPromise = (async () => {
        const data = await this.executeWrite(store, request.operation, request.payload, mode, requestId);
        await this.idempotencyStore.set(idempotencyKey, {
          payloadHash,
          responseData: data,
          createdAtMs: Date.now(),
        });
        return data;
      })();

      this.inFlightWrites.set(idempotencyKey, execPromise);
      try {
        const data = await execPromise;
        return {
          storeId: request.storeId,
          operation: request.operation,
          success: true,
          data,
        };
      } finally {
        this.inFlightWrites.delete(idempotencyKey);
      }
    }

    let data: unknown;
    if (isWrite) {
      data = await this.executeWrite(store, request.operation, request.payload, mode, requestId);
    } else {
      data = await this.executeRead(store, request.operation, request.payload, requestId);
    }

    return {
      storeId: request.storeId,
      operation: request.operation,
      success: true,
      data,
    };
  }

  private async executeRead(
    store: StoreConfig,
    operation: string,
    payload: unknown,
    requestId?: string,
  ): Promise<unknown> {
    switch (operation) {
      case "connection.test":
        return executeConnectionTest(store, this.graphqlClient, payload);
      case "products.list":
        return executeProductsList(store, this.graphqlClient, payload);
      case "products.get":
        return executeProductsGet(store, this.graphqlClient, payload);
      case "collections.list":
        return executeCollectionsList(store, this.graphqlClient, payload);
      case "collections.get":
        return executeCollectionsGet(store, this.graphqlClient, payload);
      default:
        throw new GatewayError(`Unsupported operation: ${operation}`, "SHOPIFY_INVALID_INPUT", 400);
    }
  }

  private async executeWrite(
    store: StoreConfig,
    operation: string,
    payload: unknown,
    mode: "preview" | "apply",
    requestId?: string,
  ): Promise<unknown> {
    switch (operation) {
      case "products.create":
        return executeProductsCreate(store, this.graphqlClient, payload, mode, requestId);
      case "products.update":
        return executeProductsUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "products.bulkUpdate":
        return executeProductsBulkUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "products.delete":
        return executeProductsDelete(store, this.graphqlClient, payload, mode, requestId);
      case "variants.update":
        return executeVariantsUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "variants.bulkUpdate":
        return executeVariantsBulkUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "collections.create":
        return executeCollectionsCreate(store, this.graphqlClient, payload, mode, requestId);
      case "collections.update":
        return executeCollectionsUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "collections.delete":
        return executeCollectionsDelete(store, this.graphqlClient, payload, mode, requestId);
      case "collections.updateMembership":
        return executeCollectionsUpdateMembership(store, this.graphqlClient, payload, mode, requestId);
      default:
        throw new GatewayError(`Unsupported write operation: ${operation}`, "SHOPIFY_INVALID_INPUT", 400);
    }
  }
}
