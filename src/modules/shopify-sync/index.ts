export { createShopifyClient } from "./client";
export type { ShopifyClient } from "./client";

export {
  buildProductDescriptionHtml,
  fromCustomizationNormalizerBatch,
  fromCustomizationNormalizerProduct,
} from "./adapter";

export { mockShopifySyncExpectedOutput, shopifySyncMockData } from "./mocks/data";
export { runMockShopifySync } from "./mocks/runner";

export { getShopifySyncRunner } from "./runtime";
export type { ShopifySyncRunner } from "./runtime";

export {
  createShopifyProduct,
  createShopifyVariants,
  replaceUrlsInObject,
  runShopifySync,
  setProductCustomizerMetafield,
  syncSingleProduct,
  uploadShopifyAsset,
} from "./service";

export type {
  GraphqlResponse,
  GraphqlUserError,
  ShopifyCredentials,
  ShopifyCustomizationAssetInput,
  ShopifyMediaInput,
  ShopifyProductCustomizerInput,
  ShopifySyncBatchInput,
  ShopifySyncBatchOutput,
  ShopifySyncOptions,
  ShopifySyncProductInput,
  ShopifySyncProductResult,
  ShopifyVariantInput,
  ShopifyVariantOptionValue,
} from "./types";
