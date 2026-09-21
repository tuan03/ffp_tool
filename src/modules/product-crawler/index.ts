export {
  buildMockJobOutput,
  createMockSvgThumbnail,
  defaultMockCrawlerOptions,
  getFreshMockProducts,
  mockCrawlerErrors,
  mockProduct1Handbag,
  mockProduct2Watch,
  mockProduct3MugWarning,
  mockProduct4Backpack,
  mockSampleProducts,
} from "./mocks/data";

export {
  MockProductCrawlerClient,
  mockProductCrawlerClient,
} from "./mocks/runner";

export {
  createProductCrawlerRoutes,
  productCrawlerRoutes,
} from "./routes";

export {
  getProductCrawlerClient,
} from "./runtime";

export {
  crawlerProductToListItem,
  crawlerProductToSeoInput,
  parseInputLines,
  realProductCrawlerClient,
  RealProductCrawlerClient,
  validateCrawlerInput,
} from "./service";

export type {
  CrawlerDiagnostics,
  CrawlerError,
  CrawlerMedia,
  CrawlerProduct,
  CrawlerProductListItem,
  CustomizationColorGroup,
  CustomizationFontGroup,
  CustomizationImageInput,
  CustomizationOption,
  CustomizationOptionGroup,
  CustomizationSurface,
  CustomizationTextInput,
  ParsedInputRow,
  ProductCrawlerCancelResponse,
  ProductCrawlerClient,
  ProductCrawlerCreateJobResponse,
  ProductCrawlerFilter,
  ProductCrawlerInputItem,
  ProductCrawlerJobInput,
  ProductCrawlerJobOutput,
  ProductCrawlerJobStatus,
  ProductCrawlerJobStatusResponse,
  ProductCrawlerOptions,
  ProductCrawlerStatistics,
  ProductCrawlerStepper,
  ProductCrawlerSummary,
  ProductCustomization,
  ProductVariant,
  SeoContentInput,
  SourceVariant,
  SplitContext,
  VariantMatrix,
} from "./types";

export { ProductCrawlerPage } from "./ui/ProductCrawlerPage";
