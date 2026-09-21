import { GatewayError } from "./errors";
import { executeCollectionsGet, executeCollectionsList } from "./operations/collections";
import { executeConnectionTest } from "./operations/connection-test";
import { executeProductsGet, executeProductsList } from "./operations/products";
import { executeWriteNotImplemented } from "./operations/write-not-implemented";
import type { ShopifyGraphqlClient } from "./shopify-graphql-client";
import type { StoreRegistry } from "./store-registry";
import type { GatewayRequest, GatewayResponse } from "./types";

export interface GatewayDispatcherOptions {
  readonly storeRegistry: StoreRegistry;
  readonly graphqlClient: ShopifyGraphqlClient;
}

export class GatewayDispatcher {
  private readonly storeRegistry: StoreRegistry;
  private readonly graphqlClient: ShopifyGraphqlClient;

  public constructor(options: GatewayDispatcherOptions) {
    this.storeRegistry = options.storeRegistry;
    this.graphqlClient = options.graphqlClient;
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

    let data: unknown;
    switch (request.operation) {
      case "connection.test":
        data = await executeConnectionTest(store, this.graphqlClient, request.payload);
        break;
      case "products.list":
        data = await executeProductsList(store, this.graphqlClient, request.payload);
        break;
      case "products.get":
        data = await executeProductsGet(store, this.graphqlClient, request.payload);
        break;
      case "collections.list":
        data = await executeCollectionsList(store, this.graphqlClient, request.payload);
        break;
      case "collections.get":
        data = await executeCollectionsGet(store, this.graphqlClient, request.payload);
        break;
      case "products.create":
      case "products.update":
      case "products.bulkUpdate":
      case "products.delete":
      case "variants.update":
      case "variants.bulkUpdate":
      case "collections.create":
      case "collections.update":
      case "collections.delete":
      case "collections.updateMembership":
        data = await executeWriteNotImplemented(request.operation);
        break;
      default:
        throw new GatewayError(`Unsupported operation: ${request.operation}`, "SHOPIFY_INVALID_INPUT", 400);
    }

    return {
      storeId: request.storeId,
      operation: request.operation,
      success: true,
      data,
    };
  }
}
