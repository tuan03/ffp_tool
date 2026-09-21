export {
  autoSeoRoutes,
  createAutoSeoRoutes,
} from "./routes";

export {
  getAutoSeoClient,
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
  AutoSeoContentInput,
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoProductImage,
  AutoSeoWorkflowInput,
  ProductReviewDecision,
  ShopifyProductForAutoSeoUi,
  ShopifyProductImage,
  ShopifyProductVariant,
} from "./types";

export { AutoSeoPage } from "./ui/AutoSeoPage";
