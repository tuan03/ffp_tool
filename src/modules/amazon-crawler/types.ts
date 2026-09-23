export type AmazonCrawlerProfile = "default" | "jeminise";

export type AmazonCrawlerJobStatus =
  | "queued"
  | "running"
  | "waiting_captcha"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface Money {
  raw: string;
  amount: number;
  currency: string;
}

export interface AmazonCrawlerSettings {
  profileSlug: AmazonCrawlerProfile;
  applyJeminisePreset: boolean;
  productThreads: number;
  variantThreads: number;
  urllibThreads: number;
  browserProfiles: number;
  browserTabs: number;
  headless: boolean;
  amazonZip: string;
  captchaTimeoutSeconds: number;
  maxMatrixVariants: number;
  storeId?: string;
  priceAddition?: number;
  discountPercent?: number;
  collectionId?: string;
  collectionIds?: readonly string[];
  productType?: string;
}

export interface AmazonCrawlerInput extends AmazonCrawlerSettings {
  urls: readonly string[];
}

export interface AmazonCrawlerActiveVariant {
  asin: string;
  options: Record<string, string>;
}

export interface AmazonCrawlerProgressItem {
  source: string;
  asin: string;
  phase: AmazonCrawlerProgress["phase"];
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  message: string;
  variantCompleted: number;
  variantTotal: number;
  currentAsin?: string;
  currentOptions?: Record<string, string>;
  activeVariants?: AmazonCrawlerActiveVariant[];
  networkRoute?: "direct" | "proxy";
  browserProfile?: string;
}

export interface AmazonCrawlerBrowserPoolProgress {
  directProfiles: number;
  proxyProfiles: number;
  tabsPerProfile: number;
  directActive: number;
  proxyActive: number;
  directQueued: number;
  proxyQueued: number;
}

export interface AmazonCrawlerProgress {
  phase: "queued" | "product" | "variant_matrix" | "customization" | "normalization" | "seo" | "shopify" | "export" | "captcha";
  completed: number;
  total: number;
  message: string;
  source?: string;
  items?: AmazonCrawlerProgressItem[];
  browserPool?: AmazonCrawlerBrowserPoolProgress;
}

export type ProductPipelineStatus =
  | "received"
  | "normalizing"
  | "seo"
  | "syncing"
  | "retry_wait"
  | "completed"
  | "failed"
  | "reconciliation_required"
  | "cancelled";

export interface ProductPipelineMetadata {
  status: ProductPipelineStatus;
  normalization: {
    status: "pending" | "running" | "completed";
    assetsNormalized: number;
  };
  seo: {
    status: "pending" | "running" | "completed" | "failed";
    engine?: "gemini" | "heuristic" | "mixed";
    fieldsApplied?: string[];
    fallbackStages?: string[];
    warnings?: string[];
    error?: string | null;
  };
  shopify: {
    storeId?: string;
    productId?: string;
    productHandle?: string;
    adminUrl?: string;
    attempts: number;
    proxyProfile?: string | null;
    warnings?: string[];
    error?: string | null;
    noOp?: boolean;
    timings?: ProductPipelineTimings;
  };
}

export interface ProductPipelineTimings {
  pipeline?: {
    normalizationMs?: number;
    shopifyResolveMs?: number;
    seoInitialMs?: number;
    seoQueueWaitMs?: number;
    seoRebaseMs?: number;
    seoRegistrationMs?: number;
    seoTotalMs?: number;
    shopifySyncMs?: number;
    totalMs?: number;
  };
  shopify?: {
    productWriteMs?: number;
    variantsMs?: number;
    assetUploadMs?: number;
    metafieldMs?: number;
    totalMs?: number;
  };
}

export interface AmazonCrawlerError {
  source: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface ProductMedia {
  url: string;
  kind: "image" | "video";
  sourceAsin?: string;
  alt?: string;
}

export interface PriceInference {
  isInferred: boolean;
  sourceAsins: string[];
  reason?: string;
}

export interface AmazonSourceVariant {
  asin: string;
  url: string;
  options: Record<string, string>;
  price: Money | null;
  media: ProductMedia[];
  customizationFingerprint: string | null;
  priceInference: PriceInference;
  warnings: string[];
  diagnostics?: ProductDiagnostics;
}

export interface AmazonFinalVariant {
  id: string;
  sku: string;
  sourceAsin: string | null;
  options: Record<string, string>;
  price: Money | null;
  surcharge: Money | null;
  metadata: Record<string, unknown>;
}

export interface VariantMatrix {
  dimensions: Record<string, string[]>;
  expectedCount: number;
  discoveredCount: number;
  complete: boolean;
  safetyCap: number;
}

export interface CustomizationOption {
  id: string;
  label: string;
  price: Money;
  isAvailable: boolean;
  overlayImage?: { url: string; width?: number | null; height?: number | null } | null;
  thumbnailImage?: { url: string; width?: number | null; height?: number | null } | null;
}

export interface CustomizationControl {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options?: CustomizationOption[];
  [key: string]: unknown;
}

export interface CustomizationPricingGroup {
  id: string;
  label: string;
  required: boolean;
  defaultOptionId: string;
  options: CustomizationOption[];
}

export interface CustomizationPricing {
  currencyCode: string;
  mode: "product_variants";
  paidOptionGroups: CustomizationPricingGroup[];
}

export interface NormalizedCustomization {
  schemaVersion: number;
  source: Record<string, string>;
  product: { productImageUrl: string; previewSize: number };
  surfaces: unknown[];
  optionGroups: CustomizationControl[];
  textInputs: CustomizationControl[];
  imageInputs: CustomizationControl[];
  fontGroups: CustomizationControl[];
  colorGroups: CustomizationControl[];
  placements: unknown[];
  conditionalRules: unknown[];
  regexChoices: Record<string, unknown>;
  controlOrder: Array<{ type: string; id: string }>;
  componentParent: Record<string, string>;
  componentTypes: Record<string, string>;
  assets: unknown[];
  pricing: CustomizationPricing;
  fingerprint: string;
}

export interface SplitContext {
  attribute: string | null;
  value: string | null;
  groupKey: string;
  sourceAsins: string[];
}

export interface ProductDiagnostics {
  fetchMode: "http" | "playwright" | "cache" | "mixed" | "failed";
  attempts: number;
  captchaEncountered: boolean;
  locationFallbackUsed: boolean;
  amazonZip?: string;
  usProfileApplied?: boolean;
  matrixSwept: boolean;
  cacheHit: boolean;
  fetchTrace?: {
    http: Array<Record<string, unknown>>;
    playwright: Array<Record<string, unknown>>;
  };
}

export interface AmazonCrawlerProduct {
  id: string;
  sourceKey?: string;
  parentAsin: string;
  canonicalUrl: string;
  sourceTitle: string;
  title: string;
  description: string | null;
  descriptionHtml?: string;
  handle?: string;
  seo?: {
    title: string;
    description: string;
  };
  bulletPoints: string[];
  categories: string[];
  productDetails: Record<string, string>;
  media: ProductMedia[];
  sourceVariants: AmazonSourceVariant[];
  variants: AmazonFinalVariant[];
  variantMatrix: VariantMatrix;
  customization: NormalizedCustomization | null;
  splitContext: SplitContext;
  preset: string | null;
  warnings: string[];
  diagnostics: ProductDiagnostics;
  pipeline?: ProductPipelineMetadata;
}

export interface AmazonCrawlerStatistics {
  requestedInputs: number;
  acceptedInputs: number;
  rejectedInputs: number;
  products: number;
  sourceVariants: number;
  finalVariants: number;
  durationMs: number;
}

export interface AmazonCrawlerOutput {
  version: string;
  jobId: string;
  status: Extract<AmazonCrawlerJobStatus, "completed" | "partial" | "cancelled">;
  startedAt: string;
  completedAt: string;
  settings: AmazonCrawlerSettings;
  products: AmazonCrawlerProduct[];
  errors: AmazonCrawlerError[];
  warnings: string[];
  statistics: AmazonCrawlerStatistics;
  exportFilename: string | null;
}

export interface AmazonCrawlerRunOptions {
  input: AmazonCrawlerInput;
  onProgress?: (progress: AmazonCrawlerProgress) => void;
  onProducts?: (products: readonly AmazonCrawlerProduct[]) => void;
  signal?: AbortSignal;
}

export interface AmazonCrawlerSyncRetrier {
  (
    jobId: string,
    options?: {
      onProgress?: (progress: AmazonCrawlerProgress) => void;
      onProducts?: (products: readonly AmazonCrawlerProduct[]) => void;
      signal?: AbortSignal;
    },
  ): Promise<{ retried: number; output?: AmazonCrawlerOutput }>;
}

export interface AmazonCrawlerJobSnapshot {
  jobId: string;
  status: AmazonCrawlerJobStatus;
  progress: AmazonCrawlerProgress;
  result: AmazonCrawlerOutput | null;
  error: string | null;
}

export interface AmazonCrawlerRunner {
  (options: AmazonCrawlerRunOptions): Promise<AmazonCrawlerOutput>;
}

export interface AmazonCrawlerCacheClearResult {
  removedFiles: number;
  removedBytes: number;
}

export interface AmazonCrawlerCacheClearer {
  (): Promise<AmazonCrawlerCacheClearResult>;
}

export type AmazonCrawlerClientStatus = "online" | "offline" | "busy" | "waiting_captcha" | "paused";

export interface AmazonCrawlerClientSummary {
  id: string;
  displayName: string;
  status: AmazonCrawlerClientStatus;
  isConnected: boolean;
  maxConcurrentInputs: number;
  activeTasks: number;
  leasedTasks: number;
  availableSlots: number;
  lastSeenAt: string | null;
}

export interface AmazonCrawlerClientsLoader {
  (): Promise<AmazonCrawlerClientSummary[]>;
}

export const DEFAULT_AMAZON_CRAWLER_SETTINGS: AmazonCrawlerSettings = {
  profileSlug: "default",
  applyJeminisePreset: false,
  productThreads: 3,
  variantThreads: 8,
  urllibThreads: 12,
  browserProfiles: 4,
  browserTabs: 2,
  headless: false,
  amazonZip: "10001",
  captchaTimeoutSeconds: 180,
  maxMatrixVariants: 500,
  storeId: "capozen",
  priceAddition: 0,
  discountPercent: 0,
  collectionId: "",
  collectionIds: [],
  productType: "",
};
