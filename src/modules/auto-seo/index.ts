export {
  autoSeoRoutes,
  createAutoSeoRoutes,
} from "./routes";

export {
  getAutoSeoClient,
  getAutoSeoRunner,
} from "./runtime";

export {
  RealAutoSeoClient,
  realAutoSeoClient,
  runAutoSeo,
} from "./service";

export {
  mapShopifyProductToAutoSeoCandidate,
} from "./shopify-adapter";

export type {
  AutoSeoClient,
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoProductImage,
  AutoSeoSelectionInput,
  ProductReviewDecision,
  SeoContentInputPayload,
  ShopifyProductForAutoSeoUi,
  ShopifyProductImage,
  ShopifyProductVariant,
  ShopifyStatusFilter,
} from "./types";

export { AutoSeoPage } from "./ui/AutoSeoPage";
