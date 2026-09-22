export { createShopifyClient, createShopifyGateway } from "./client";
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
  createDryRunGateway,
  replaceUrlsInObject,
  runShopifySync,
  syncSingleProduct,
} from "./service";

export type {
  CreateProductInput,
  CreateProductOutput,
  CreateVariantItem,
  CreateVariantsOutput,
  SetMetafieldInput,
  SetMetafieldOutput,
  ShopifyCredentials,
  ShopifyCustomizationAssetInput,
  ShopifyGateway,
  ShopifyMediaInput,
  ShopifyProductCustomizerInput,
  ShopifySyncBatchInput,
  ShopifySyncBatchOutput,
  ShopifySyncOptions,
  ShopifySyncProductInput,
  ShopifySyncProductResult,
  ShopifyVariantInput,
  ShopifyVariantOptionValue,
  UploadFileInput,
  UploadFileOutput,
} from "./types";
