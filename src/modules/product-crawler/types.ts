export interface ProductCrawlerInputItem {
  type: "asin" | "url";
  value: string;
}

export interface ProductCrawlerOptions {
  profileSlug?: string;
  productThreads?: number;
  variantThreads?: number;
  urllibThreads?: number;
  browserProfiles?: number;
  browserTabs?: number;
  headless?: boolean;
  amazonZip?: string;
  captchaTimeoutSeconds?: number;
  maxMatrixVariants?: number;
}

export interface ProductCrawlerJobInput {
  source: "amazon";
  inputs: ProductCrawlerInputItem[];
  crawlMode: "exact" | "group";
  options?: ProductCrawlerOptions;
}

export type ProductCrawlerJobStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface ProductCrawlerCreateJobResponse {
  ok: boolean;
  jobId: string;
  status: ProductCrawlerJobStatus;
}

export interface ProductCrawlerStepper {
  currentStep: number;
  percent: number;
  currentMessage: string;
}

export interface ProductCrawlerSummary {
  requestedInputs: number;
  productsFound: number;
  productsCompleted: number;
  productsFailed: number;
}

export interface CrawlerMedia {
  url: string;
  kind: "image" | "video";
  sourceAsin?: string;
}

export interface SourceVariant {
  asin: string;
  title?: string;
  price?: number;
  currency?: string;
  dimensions?: Record<string, string>;
  inStock?: boolean;
}

export interface ProductVariant {
  id: string;
  sku: string;
  sourceAsin: string;
  title?: string;
  options: Record<string, string>;
  price?: {
    amount: number;
    currency: string;
  };
  surcharge?: {
    amount: number;
    currency: string;
  };
}

export interface VariantMatrix {
  dimensions: Record<string, string[]>;
  combinationsCount: number;
}

export interface CustomizationOption {
  label: string;
  value: string;
  priceDelta?: number;
}

export interface CustomizationOptionGroup {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  options: CustomizationOption[];
}

export interface CustomizationTextInput {
  id: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
}

export interface CustomizationImageInput {
  id: string;
  label: string;
  required?: boolean;
}

export interface CustomizationFontGroup {
  id: string;
  name: string;
  fonts: string[];
}

export interface CustomizationColorGroup {
  id: string;
  name: string;
  colors: string[];
}

export interface CustomizationSurface {
  name: string;
  previewUrl?: string;
  areas?: unknown[];
}

export interface ProductCustomization {
  source?: string;
  productImage?: string;
  surfaces?: CustomizationSurface[];
  optionGroups?: CustomizationOptionGroup[];
  textInputs?: CustomizationTextInput[];
  imageInputs?: CustomizationImageInput[];
  fontGroups?: CustomizationFontGroup[];
  colorGroups?: CustomizationColorGroup[];
  placements?: unknown[];
  pricing?: Record<string, unknown>;
  assets?: unknown[];
}

export interface SplitContext {
  isSplit: boolean;
  splitBy?: string;
  parentId?: string;
}

export interface CrawlerDiagnostics {
  fetchDurationMs?: number;
  retries?: number;
  cached?: boolean;
}

export interface CrawlerProduct {
  id: string;
  parentAsin?: string;
  canonicalUrl: string;
  sourceTitle?: string;
  title: string;
  description?: string;
  bulletPoints?: string[];
  categories?: string[];
  productDetails?: Record<string, string>;
  media: CrawlerMedia[];
  sourceVariants: SourceVariant[];
  variants: ProductVariant[];
  variantMatrix?: VariantMatrix;
  customization?: ProductCustomization | null;
  splitContext?: SplitContext;
  warnings?: string[];
  diagnostics?: CrawlerDiagnostics;
}

export interface CrawlerError {
  code: string;
  message: string;
  input?: string;
  productId?: string;
  retryable: boolean;
  details?: unknown;
}

export interface ProductCrawlerStatistics {
  requestedInputs: number;
  acceptedInputs: number;
  rejectedInputs: number;
  products: number;
  sourceVariants: number;
  finalVariants: number;
  durationMs: number;
}

export interface ProductCrawlerJobOutput {
  version: string;
  jobId: string;
  status: "completed" | "partial";
  startedAt: string;
  completedAt: string;
  products: CrawlerProduct[];
  errors: CrawlerError[];
  warnings: string[];
  statistics: ProductCrawlerStatistics;
}

export interface ProductCrawlerJobStatusResponse {
  ok: boolean;
  jobId: string;
  status: ProductCrawlerJobStatus;
  stepper?: ProductCrawlerStepper;
  summary?: ProductCrawlerSummary;
  logs: string[];
  output?: ProductCrawlerJobOutput;
  error?: string;
}

export interface ProductCrawlerCancelResponse {
  ok: boolean;
  status: "cancelled";
}

export interface CrawlerProductListItem {
  id: string;
  title: string;
  thumbnailUrl?: string;
  asin?: string;
  variantCount: number;
  hasCustomization: boolean;
  warningCount: number;
  status: "success" | "partial" | "failed";
}

export type ProductCrawlerFilter =
  | "all"
  | "success"
  | "partial"
  | "has_customization"
  | "no_customization"
  | "has_warning";

export interface ParsedInputRow {
  raw: string;
  type: "asin" | "url" | "invalid";
  value: string;
  isValid: boolean;
  error?: string;
}

export interface SeoContentInput {
  productId: string;
  title: string;
  description?: string;
  images: string[];
  sourceUrl: string;
  sourceContext: {
    bulletPoints?: string[];
    productDetails?: Record<string, string>;
    customization?: ProductCustomization | null;
  };
}

export interface ProductCrawlerClient {
  startJob(input: ProductCrawlerJobInput): Promise<ProductCrawlerCreateJobResponse>;
  getJob(jobId: string): Promise<ProductCrawlerJobStatusResponse>;
  cancelJob(jobId: string): Promise<ProductCrawlerCancelResponse>;
  retryJob?(jobId: string, itemIds?: string[]): Promise<ProductCrawlerCreateJobResponse>;
}
