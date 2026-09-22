export { customizationNormalizerMockData } from "./mocks/data";
export { runMockCustomizationNormalizer } from "./mocks/runner";
export { getCustomizationNormalizerRunner } from "./runtime";
export {
  cleanImageUrl,
  computeShortHash,
  extractFileExtension,
  generateFriendlyFileName,
  hasCustomization,
  normalizeCustomizationProduct,
  runCustomizationNormalizer,
  slugify,
} from "./service";
export type {
  CrawlJobSettings,
  CrawlJobStatistics,
  CrawlProduct,
  CustomizationAsset,
  CustomizationNormalizerInput,
  CustomizationNormalizerOutput,
  CustomizationOption,
  CustomizationOptionGroup,
  CustomizationOptionPrice,
  CustomizationPricing,
  ImageDimension,
  ImageResource,
  NormalizationSummary,
  ProductCustomization,
  ProductMediaItem,
} from "./types";
