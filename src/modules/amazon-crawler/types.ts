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
}

export interface AmazonCrawlerInput extends AmazonCrawlerSettings {
  urls: readonly string[];
}

export interface AmazonCrawlerProgress {
  phase: "queued" | "product" | "variant_matrix" | "customization" | "export" | "captcha";
  completed: number;
  total: number;
  message: string;
  source?: string;
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
  listPrice: Money | null;
  availability: string | null;
  isAvailable: boolean;
  media: ProductMedia[];
  customizationFingerprint: string | null;
  priceInference: PriceInference;
  warnings: string[];
}

export interface AmazonFinalVariant {
  id: string;
  sku: string;
  sourceAsin: string | null;
  options: Record<string, string>;
  price: Money | null;
  listPrice: Money | null;
  surcharge: Money | null;
  isAvailable: boolean;
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
}

export interface CustomizationControl {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options?: CustomizationOption[];
  [key: string]: unknown;
}

export interface NormalizedCustomization {
  surfaces: unknown[];
  controls: CustomizationControl[];
  rules: unknown[];
  assets: unknown[];
  pricingGroups: CustomizationControl[];
  fingerprint: string;
}

export interface SplitContext {
  attribute: string | null;
  value: string | null;
  groupKey: string;
  sourceAsins: string[];
}

export interface ProductDiagnostics {
  fetchMode: "http" | "playwright" | "cache" | "mixed";
  attempts: number;
  captchaEncountered: boolean;
  locationFallbackUsed: boolean;
  matrixSwept: boolean;
  cacheHit: boolean;
}

export interface AmazonCrawlerProduct {
  id: string;
  parentAsin: string;
  canonicalUrl: string;
  sourceTitle: string;
  title: string;
  description: string | null;
  bulletPoints: string[];
  brand: string | null;
  seller: string | null;
  categories: string[];
  productDetails: Record<string, string>;
  rating: string | null;
  reviewCount: number | null;
  availability: string | null;
  media: ProductMedia[];
  sourceVariants: AmazonSourceVariant[];
  variants: AmazonFinalVariant[];
  variantMatrix: VariantMatrix;
  customizationRaw: unknown | null;
  customization: NormalizedCustomization | null;
  splitContext: SplitContext;
  preset: string | null;
  warnings: string[];
  diagnostics: ProductDiagnostics;
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
  signal?: AbortSignal;
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

export const DEFAULT_AMAZON_CRAWLER_SETTINGS: AmazonCrawlerSettings = {
  profileSlug: "default",
  applyJeminisePreset: false,
  productThreads: 3,
  variantThreads: 4,
  urllibThreads: 8,
  browserProfiles: 1,
  browserTabs: 3,
  headless: false,
  amazonZip: "10001",
  captchaTimeoutSeconds: 180,
  maxMatrixVariants: 500,
};
