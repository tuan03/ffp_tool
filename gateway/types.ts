export interface StoreAuthConfig {
  readonly type: "static" | "client_credentials";
  readonly staticToken?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
}

export interface StoreProxyConfig {
  readonly url: string;
  readonly username?: string;
  readonly password?: string;
  readonly failClosed?: boolean;
}

export interface StoreConfig {
  readonly storeId: string;
  readonly shopDomain: string;
  readonly apiVersion: string;
  readonly auth: StoreAuthConfig;
  readonly proxy?: StoreProxyConfig;
}

export type GatewayErrorCode =
  | "SHOPIFY_AUTH_FAILED"
  | "SHOPIFY_PERMISSION_DENIED"
  | "SHOPIFY_THROTTLED"
  | "SHOPIFY_USER_ERROR"
  | "SHOPIFY_NETWORK_ERROR"
  | "SHOPIFY_NOT_FOUND"
  | "SHOPIFY_INVALID_INPUT"
  | "NOT_IMPLEMENTED"
  | "SHOPIFY_UNKNOWN_WRITE_STATE"
  | "SHOPIFY_PARTIAL_WRITE";

export interface GatewayRequest<TPayload = unknown> {
  readonly storeId?: string;
  readonly operation: string;
  readonly payload: TPayload;
  readonly requestId?: string;
  readonly mode?: "preview" | "apply";
}

export interface GatewaySuccessResponse<TData = unknown> {
  readonly storeId: string;
  readonly operation: string;
  readonly success: true;
  readonly data: TData;
}

export interface GatewayErrorDetails {
  readonly code: GatewayErrorCode;
  readonly message: string;
  readonly retryAfterSeconds?: number;
  readonly fields?: readonly string[];
  readonly retryable?: boolean;
  readonly reconciliationRequired?: boolean;
  readonly details?: Record<string, unknown>;
}

export interface GatewayErrorResponse {
  readonly storeId: string;
  readonly operation: string;
  readonly success: false;
  readonly error: GatewayErrorDetails;
}

export type GatewayResponse<TData = unknown> =
  | GatewaySuccessResponse<TData>
  | GatewayErrorResponse;

export interface GraphQLThrottleStatus {
  readonly maximumAvailable: number;
  readonly currentlyAvailable: number;
  readonly restoreRate: number;
}

export interface GraphQLCostExtension {
  readonly requestedQueryCost?: number;
  readonly actualQueryCost?: number;
  readonly throttleStatus?: GraphQLThrottleStatus;
}

export interface GraphQLErrorItem {
  readonly message: string;
  readonly locations?: readonly { readonly line: number; readonly column: number }[];
  readonly path?: readonly (string | number)[];
  readonly extensions?: {
    readonly code?: string;
    readonly [key: string]: unknown;
  };
}

export interface GraphQLResponse<TData = unknown> {
  readonly data?: TData;
  readonly errors?: readonly GraphQLErrorItem[];
  readonly extensions?: {
    readonly cost?: GraphQLCostExtension;
    readonly [key: string]: unknown;
  };
}

export type HttpTransport = (url: string, init?: RequestInit) => Promise<Response>;

// Public domain read contracts matching module-api
export interface ConnectionTestData {
  readonly isConnected: boolean;
  readonly connected: boolean;
  readonly shopDomain: string;
  readonly shopName: string;
  readonly currencyCode: string;
}

export interface ProductVariantSummary {
  readonly id: string;
  readonly productId: string;
  readonly title: string;
  readonly price: string;
  readonly compareAtPrice?: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly inventoryQuantity?: number;
}

export interface ProductImageSummary {
  readonly id?: string;
  readonly url: string;
  readonly altText?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface ProductSummary {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly description?: string;
  readonly descriptionHtml?: string;
  readonly status: "ACTIVE" | "ARCHIVED" | "DRAFT";
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags: readonly string[];
  readonly onlineStoreUrl?: string;
  readonly featuredImage?: ProductImageSummary;
  readonly images?: readonly ProductImageSummary[];
  readonly variants: readonly ProductVariantSummary[];
  readonly seo?: { readonly title?: string; readonly description?: string };
  readonly hasMoreVariants?: boolean;
  readonly hasMoreImages?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PageInfoSummary {
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly startCursor?: string;
  readonly endCursor?: string;
}

export interface ProductListResult {
  readonly products: readonly ProductSummary[];
  readonly pageInfo: PageInfoSummary;
}

export interface CollectionSummary {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly description?: string;
  readonly productsCount: number;
  readonly seo?: { readonly title?: string; readonly description?: string };
  readonly updatedAt: string;
}

export interface CollectionListResult {
  readonly collections: readonly CollectionSummary[];
  readonly pageInfo: PageInfoSummary;
}
