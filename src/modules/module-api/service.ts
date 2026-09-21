import type {
  ShopifyApiInput,
  ShopifyApiResponse,
  ShopifyCollectionsCreateInput,
  ShopifyCollectionsCreateResponse,
  ShopifyCollectionsDeleteInput,
  ShopifyCollectionsDeleteResponse,
  ShopifyCollectionsGetInput,
  ShopifyCollectionsGetResponse,
  ShopifyCollectionsListInput,
  ShopifyCollectionsListResponse,
  ShopifyCollectionsUpdateInput,
  ShopifyCollectionsUpdateMembershipInput,
  ShopifyCollectionsUpdateMembershipResponse,
  ShopifyCollectionsUpdateResponse,
  ShopifyConnectionTestInput,
  ShopifyConnectionTestResponse,
  ShopifyProductsBulkUpdateInput,
  ShopifyProductsBulkUpdateResponse,
  ShopifyProductsCreateInput,
  ShopifyProductsCreateResponse,
  ShopifyProductsDeleteInput,
  ShopifyProductsDeleteResponse,
  ShopifyProductsGetInput,
  ShopifyProductsGetResponse,
  ShopifyProductsListInput,
  ShopifyProductsListResponse,
  ShopifyProductsUpdateInput,
  ShopifyProductsUpdateResponse,
  ShopifyVariantsBulkUpdateInput,
  ShopifyVariantsBulkUpdateResponse,
  ShopifyVariantsUpdateInput,
  ShopifyVariantsUpdateResponse,
} from "./types";
import { ShopifyApiError } from "./types";

/**
 * Executes real Shopify API operations via backend HTTP Gateway.
 *
 * Phase 1 note: Real HTTP Gateway integration will be implemented in Phase 2
 * once backend Gateway architecture and contracts are finalized.
 */
export async function runModuleApi(input: ShopifyConnectionTestInput): Promise<ShopifyConnectionTestResponse>;
export async function runModuleApi(input: ShopifyProductsListInput): Promise<ShopifyProductsListResponse>;
export async function runModuleApi(input: ShopifyProductsGetInput): Promise<ShopifyProductsGetResponse>;
export async function runModuleApi(input: ShopifyProductsCreateInput): Promise<ShopifyProductsCreateResponse>;
export async function runModuleApi(input: ShopifyProductsUpdateInput): Promise<ShopifyProductsUpdateResponse>;
export async function runModuleApi(input: ShopifyProductsBulkUpdateInput): Promise<ShopifyProductsBulkUpdateResponse>;
export async function runModuleApi(input: ShopifyProductsDeleteInput): Promise<ShopifyProductsDeleteResponse>;
export async function runModuleApi(input: ShopifyVariantsUpdateInput): Promise<ShopifyVariantsUpdateResponse>;
export async function runModuleApi(input: ShopifyVariantsBulkUpdateInput): Promise<ShopifyVariantsBulkUpdateResponse>;
export async function runModuleApi(input: ShopifyCollectionsListInput): Promise<ShopifyCollectionsListResponse>;
export async function runModuleApi(input: ShopifyCollectionsGetInput): Promise<ShopifyCollectionsGetResponse>;
export async function runModuleApi(input: ShopifyCollectionsCreateInput): Promise<ShopifyCollectionsCreateResponse>;
export async function runModuleApi(input: ShopifyCollectionsUpdateInput): Promise<ShopifyCollectionsUpdateResponse>;
export async function runModuleApi(input: ShopifyCollectionsDeleteInput): Promise<ShopifyCollectionsDeleteResponse>;
export async function runModuleApi(input: ShopifyCollectionsUpdateMembershipInput): Promise<ShopifyCollectionsUpdateMembershipResponse>;
export async function runModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse>;
export async function runModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse> {
  if (!input.storeId || input.storeId.trim() === "") {
    throw new ShopifyApiError("Store ID is required", "SHOPIFY_USER_ERROR");
  }

  // Gateway client integration planned for Phase 2.
  throw new ShopifyApiError(
    `Shopify API Gateway client is not configured for operation "${input.operation}". Use mock runner in mock environment.`,
    "SHOPIFY_NETWORK_ERROR",
  );
}
