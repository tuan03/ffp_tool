export type ShopifyOperation =
  | "connection.test"
  | "products.list"
  | "products.get"
  | "products.create"
  | "products.update"
  | "products.bulkUpdate"
  | "products.delete"
  | "variants.update"
  | "variants.bulkUpdate"
  | "collections.list"
  | "collections.get"
  | "collections.create"
  | "collections.update"
  | "collections.delete"
  | "collections.updateMembership";

export type ShopifyApiErrorCode =
  | "SHOPIFY_AUTH_FAILED"
  | "SHOPIFY_THROTTLED"
  | "SHOPIFY_USER_ERROR"
  | "SHOPIFY_NETWORK_ERROR"
  | "SHOPIFY_UNKNOWN_WRITE_STATE"
  | "SHOPIFY_INVALID_INPUT"
  | "SHOPIFY_NOT_FOUND"
  | "SHOPIFY_PERMISSION_DENIED"
  | "NOT_IMPLEMENTED";

export type ShopifyExecutionMode = "preview" | "apply";

export interface ModuleApiConfig {
  readonly gatewayUrl?: string;
  readonly timeoutMs?: number;
}

export interface ModuleApiDependencies {
  readonly fetch?: typeof fetch;
}

export class ShopifyApiError extends Error {
  public constructor(
    message: string,
    public readonly code: ShopifyApiErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ShopifyApiError";
  }
}

export interface ShopifyPageInfo {
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly startCursor?: string;
  readonly endCursor?: string;
}

export interface ShopifyProductVariant {
  readonly id: string;
  readonly productId: string;
  readonly title: string;
  readonly price: string;
  readonly compareAtPrice?: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly inventoryQuantity?: number;
}

export interface ShopifyProduct {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly descriptionHtml?: string;
  readonly status: "ACTIVE" | "ARCHIVED" | "DRAFT";
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags: readonly string[];
  readonly variants: readonly ShopifyProductVariant[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ShopifyCollection {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly description?: string;
  readonly productsCount: number;
  readonly updatedAt: string;
}

export interface ShopifyVariantOptionValueInput {
  readonly name?: string;
  readonly value: string;
}

export interface ShopifyProductVariantInput {
  readonly title?: string;
  readonly price?: string;
  readonly compareAtPrice?: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly optionValues?: readonly ShopifyVariantOptionValueInput[];
}

export interface ShopifyProductInput {
  readonly title: string;
  readonly handle?: string;
  readonly descriptionHtml?: string;
  readonly status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly variants?: readonly ShopifyProductVariantInput[];
}

export interface ShopifyProductUpdateInput {
  readonly title?: string;
  readonly handle?: string;
  readonly descriptionHtml?: string;
  readonly status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
}

export interface ShopifyProductBulkUpdateItem {
  readonly id: string;
  readonly product: ShopifyProductUpdateInput;
}

export interface ShopifyVariantUpdateInput {
  readonly productId?: string;
  readonly title?: string;
  readonly price?: string;
  readonly compareAtPrice?: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly inventoryQuantity?: number;
  readonly optionValues?: readonly ShopifyVariantOptionValueInput[];
}

export interface ShopifyVariantBulkUpdateItem {
  readonly id: string;
  readonly variant: ShopifyVariantUpdateInput;
}

export interface ShopifyCollectionInput {
  readonly title: string;
  readonly handle?: string;
  readonly description?: string;
}

export interface ShopifyCollectionUpdateInput {
  readonly title?: string;
  readonly handle?: string;
  readonly description?: string;
}

// 1. connection.test
export interface ShopifyConnectionTestPayload {
  readonly timeoutMs?: number;
}

export interface ShopifyConnectionTestData {
  readonly isConnected: boolean;
  readonly connected: boolean;
  readonly shopDomain: string;
  readonly shopName: string;
  readonly currencyCode: string;
}

export interface ShopifyConnectionTestInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly operation: "connection.test";
  readonly payload: ShopifyConnectionTestPayload;
}

export interface ShopifyConnectionTestResponse {
  readonly storeId: string;
  readonly operation: "connection.test";
  readonly success: true;
  readonly data: ShopifyConnectionTestData;
}

// 2. products.list
export interface ShopifyProductsListPayload {
  readonly limit?: number;
  readonly cursor?: string;
  readonly query?: string;
  readonly status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
}

export interface ShopifyProductsListData {
  readonly products: readonly ShopifyProduct[];
  readonly pageInfo: ShopifyPageInfo;
}

export interface ShopifyProductsListInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly operation: "products.list";
  readonly payload: ShopifyProductsListPayload;
}

export interface ShopifyProductsListResponse {
  readonly storeId: string;
  readonly operation: "products.list";
  readonly success: true;
  readonly data: ShopifyProductsListData;
}

// 3. products.get
export interface ShopifyProductsGetPayload {
  readonly id: string;
}

export interface ShopifyProductsGetData {
  readonly product: ShopifyProduct | null;
}

export interface ShopifyProductsGetInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly operation: "products.get";
  readonly payload: ShopifyProductsGetPayload;
}

export interface ShopifyProductsGetResponse {
  readonly storeId: string;
  readonly operation: "products.get";
  readonly success: true;
  readonly data: ShopifyProductsGetData;
}

// 4. products.create
export interface ShopifyProductsCreatePayload {
  readonly product: ShopifyProductInput;
}

export interface ShopifyProductsCreateData {
  readonly product: ShopifyProduct;
}

export interface ShopifyProductsCreateInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "products.create";
  readonly payload: ShopifyProductsCreatePayload;
}

export interface ShopifyProductsCreateResponse {
  readonly storeId: string;
  readonly operation: "products.create";
  readonly success: true;
  readonly data: ShopifyProductsCreateData;
}

// 5. products.update
export interface ShopifyProductsUpdatePayload {
  readonly id: string;
  readonly product: ShopifyProductUpdateInput;
}

export interface ShopifyProductsUpdateData {
  readonly product: ShopifyProduct;
}

export interface ShopifyProductsUpdateInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "products.update";
  readonly payload: ShopifyProductsUpdatePayload;
}

export interface ShopifyProductsUpdateResponse {
  readonly storeId: string;
  readonly operation: "products.update";
  readonly success: true;
  readonly data: ShopifyProductsUpdateData;
}

// 6. products.bulkUpdate
export interface ShopifyProductsBulkUpdatePayload {
  readonly products: readonly ShopifyProductBulkUpdateItem[];
}

export interface ShopifyProductsBulkUpdateItemResult {
  readonly id: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface ShopifyProductsBulkUpdateData {
  readonly updatedProductIds: readonly string[];
  readonly count: number;
  readonly successCount?: number;
  readonly failedCount?: number;
  readonly items?: readonly ShopifyProductsBulkUpdateItemResult[];
}

export interface ShopifyProductsBulkUpdateInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "products.bulkUpdate";
  readonly payload: ShopifyProductsBulkUpdatePayload;
}

export interface ShopifyProductsBulkUpdateResponse {
  readonly storeId: string;
  readonly operation: "products.bulkUpdate";
  readonly success: true;
  readonly data: ShopifyProductsBulkUpdateData;
}

// 7. products.delete
export interface ShopifyProductsDeletePayload {
  readonly id: string;
}

export interface ShopifyProductsDeleteData {
  readonly deletedProductId: string;
}

export interface ShopifyProductsDeleteInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "products.delete";
  readonly payload: ShopifyProductsDeletePayload;
}

export interface ShopifyProductsDeleteResponse {
  readonly storeId: string;
  readonly operation: "products.delete";
  readonly success: true;
  readonly data: ShopifyProductsDeleteData;
}

// 8. variants.update
export interface ShopifyVariantsUpdatePayload {
  readonly id: string;
  readonly variant: ShopifyVariantUpdateInput;
}

export interface ShopifyVariantsUpdateData {
  readonly variant: ShopifyProductVariant;
}

export interface ShopifyVariantsUpdateInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "variants.update";
  readonly payload: ShopifyVariantsUpdatePayload;
}

export interface ShopifyVariantsUpdateResponse {
  readonly storeId: string;
  readonly operation: "variants.update";
  readonly success: true;
  readonly data: ShopifyVariantsUpdateData;
}

// 9. variants.bulkUpdate
export interface ShopifyVariantsBulkUpdatePayload {
  readonly variants: readonly ShopifyVariantBulkUpdateItem[];
}

export interface ShopifyVariantsBulkUpdateData {
  readonly updatedVariantIds: readonly string[];
  readonly count: number;
}

export interface ShopifyVariantsBulkUpdateInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "variants.bulkUpdate";
  readonly payload: ShopifyVariantsBulkUpdatePayload;
}

export interface ShopifyVariantsBulkUpdateResponse {
  readonly storeId: string;
  readonly operation: "variants.bulkUpdate";
  readonly success: true;
  readonly data: ShopifyVariantsBulkUpdateData;
}

// 10. collections.list
export interface ShopifyCollectionsListPayload {
  readonly limit?: number;
  readonly cursor?: string;
  readonly query?: string;
}

export interface ShopifyCollectionsListData {
  readonly collections: readonly ShopifyCollection[];
  readonly pageInfo: ShopifyPageInfo;
}

export interface ShopifyCollectionsListInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly operation: "collections.list";
  readonly payload: ShopifyCollectionsListPayload;
}

export interface ShopifyCollectionsListResponse {
  readonly storeId: string;
  readonly operation: "collections.list";
  readonly success: true;
  readonly data: ShopifyCollectionsListData;
}

// 11. collections.get
export interface ShopifyCollectionsGetPayload {
  readonly id: string;
}

export interface ShopifyCollectionsGetData {
  readonly collection: ShopifyCollection | null;
}

export interface ShopifyCollectionsGetInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly operation: "collections.get";
  readonly payload: ShopifyCollectionsGetPayload;
}

export interface ShopifyCollectionsGetResponse {
  readonly storeId: string;
  readonly operation: "collections.get";
  readonly success: true;
  readonly data: ShopifyCollectionsGetData;
}

// 12. collections.create
export interface ShopifyCollectionsCreatePayload {
  readonly collection: ShopifyCollectionInput;
}

export interface ShopifyCollectionsCreateData {
  readonly collection: ShopifyCollection;
}

export interface ShopifyCollectionsCreateInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "collections.create";
  readonly payload: ShopifyCollectionsCreatePayload;
}

export interface ShopifyCollectionsCreateResponse {
  readonly storeId: string;
  readonly operation: "collections.create";
  readonly success: true;
  readonly data: ShopifyCollectionsCreateData;
}

// 13. collections.update
export interface ShopifyCollectionsUpdatePayload {
  readonly id: string;
  readonly collection: ShopifyCollectionUpdateInput;
}

export interface ShopifyCollectionsUpdateData {
  readonly collection: ShopifyCollection;
}

export interface ShopifyCollectionsUpdateInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "collections.update";
  readonly payload: ShopifyCollectionsUpdatePayload;
}

export interface ShopifyCollectionsUpdateResponse {
  readonly storeId: string;
  readonly operation: "collections.update";
  readonly success: true;
  readonly data: ShopifyCollectionsUpdateData;
}

// 14. collections.delete
export interface ShopifyCollectionsDeletePayload {
  readonly id: string;
}

export interface ShopifyCollectionsDeleteData {
  readonly deletedCollectionId: string;
}

export interface ShopifyCollectionsDeleteInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "collections.delete";
  readonly payload: ShopifyCollectionsDeletePayload;
}

export interface ShopifyCollectionsDeleteResponse {
  readonly storeId: string;
  readonly operation: "collections.delete";
  readonly success: true;
  readonly data: ShopifyCollectionsDeleteData;
}

// 15. collections.updateMembership
export interface ShopifyCollectionsUpdateMembershipPayload {
  readonly collectionId: string;
  readonly productIdsToAdd?: readonly string[];
  readonly productIdsToRemove?: readonly string[];
}

export interface ShopifyCollectionsUpdateMembershipData {
  readonly collectionId: string;
  readonly addedCount: number;
  readonly removedCount: number;
}

export interface ShopifyCollectionsUpdateMembershipInput {
  readonly storeId: string;
  readonly requestId?: string;
  readonly mode?: ShopifyExecutionMode;
  readonly operation: "collections.updateMembership";
  readonly payload: ShopifyCollectionsUpdateMembershipPayload;
}

export interface ShopifyCollectionsUpdateMembershipResponse {
  readonly storeId: string;
  readonly operation: "collections.updateMembership";
  readonly success: true;
  readonly data: ShopifyCollectionsUpdateMembershipData;
}

// Discriminated Unions
export type ShopifyApiInput =
  | ShopifyConnectionTestInput
  | ShopifyProductsListInput
  | ShopifyProductsGetInput
  | ShopifyProductsCreateInput
  | ShopifyProductsUpdateInput
  | ShopifyProductsBulkUpdateInput
  | ShopifyProductsDeleteInput
  | ShopifyVariantsUpdateInput
  | ShopifyVariantsBulkUpdateInput
  | ShopifyCollectionsListInput
  | ShopifyCollectionsGetInput
  | ShopifyCollectionsCreateInput
  | ShopifyCollectionsUpdateInput
  | ShopifyCollectionsDeleteInput
  | ShopifyCollectionsUpdateMembershipInput;

export type ShopifyApiResponse =
  | ShopifyConnectionTestResponse
  | ShopifyProductsListResponse
  | ShopifyProductsGetResponse
  | ShopifyProductsCreateResponse
  | ShopifyProductsUpdateResponse
  | ShopifyProductsBulkUpdateResponse
  | ShopifyProductsDeleteResponse
  | ShopifyVariantsUpdateResponse
  | ShopifyVariantsBulkUpdateResponse
  | ShopifyCollectionsListResponse
  | ShopifyCollectionsGetResponse
  | ShopifyCollectionsCreateResponse
  | ShopifyCollectionsUpdateResponse
  | ShopifyCollectionsDeleteResponse
  | ShopifyCollectionsUpdateMembershipResponse;

export type ShopifyApiResponseFor<TOperation extends ShopifyOperation> = Extract<
  ShopifyApiResponse,
  { operation: TOperation }
>;

export interface ModuleApiRunner {
  (input: ShopifyConnectionTestInput): Promise<ShopifyConnectionTestResponse>;
  (input: ShopifyProductsListInput): Promise<ShopifyProductsListResponse>;
  (input: ShopifyProductsGetInput): Promise<ShopifyProductsGetResponse>;
  (input: ShopifyProductsCreateInput): Promise<ShopifyProductsCreateResponse>;
  (input: ShopifyProductsUpdateInput): Promise<ShopifyProductsUpdateResponse>;
  (input: ShopifyProductsBulkUpdateInput): Promise<ShopifyProductsBulkUpdateResponse>;
  (input: ShopifyProductsDeleteInput): Promise<ShopifyProductsDeleteResponse>;
  (input: ShopifyVariantsUpdateInput): Promise<ShopifyVariantsUpdateResponse>;
  (input: ShopifyVariantsBulkUpdateInput): Promise<ShopifyVariantsBulkUpdateResponse>;
  (input: ShopifyCollectionsListInput): Promise<ShopifyCollectionsListResponse>;
  (input: ShopifyCollectionsGetInput): Promise<ShopifyCollectionsGetResponse>;
  (input: ShopifyCollectionsCreateInput): Promise<ShopifyCollectionsCreateResponse>;
  (input: ShopifyCollectionsUpdateInput): Promise<ShopifyCollectionsUpdateResponse>;
  (input: ShopifyCollectionsDeleteInput): Promise<ShopifyCollectionsDeleteResponse>;
  (input: ShopifyCollectionsUpdateMembershipInput): Promise<ShopifyCollectionsUpdateMembershipResponse>;
  (input: ShopifyApiInput): Promise<ShopifyApiResponse>;
}

