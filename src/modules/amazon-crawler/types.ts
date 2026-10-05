export type AmazonCrawlerProfile = "default" | "jeminise" | "preaurem";

export type AmazonCrawlerJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "waiting_captcha"
  | "review_pending"
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
  imageProfileSlug: string;
  imageProfileRevision?: string | null;
  applyJeminisePreset: boolean;
  productThreads: number;
  variantThreads: number;
  urllibThreads: number;
  browserProfiles: number;
  browserTabs: number;
  headless: boolean;
  amazonZip: string;
  captchaTimeoutSeconds: number;
  dnsTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
  httpResponseTimeoutSeconds?: number;
  navigationTimeoutSeconds?: number;
  selectorTimeoutSeconds?: number;
  customizationTimeoutSeconds?: number;
  childTimeoutSeconds?: number;
  asinTimeoutSeconds?: number;
  jobTimeoutSeconds?: number;
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

export interface AmazonAsinPreflightMatch {
  readonly asin: string;
  readonly productId: string;
  readonly title: string;
  readonly adminUrl: string;
}

export interface AmazonAsinPreflightResult {
  readonly ready: boolean;
  readonly matches: readonly AmazonAsinPreflightMatch[];
}

export interface AmazonAsinChecker {
  (storeId: string, asins: readonly string[]): Promise<AmazonAsinPreflightResult>;
}

export interface AmazonCrawlerActiveVariant {
  asin: string;
  options: Record<string, string>;
}

export interface AmazonCrawlerProgressItem {
  taskId?: string;
  source: string;
  asin: string;
  phase: AmazonCrawlerProgress["phase"];
  status: "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
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
  phase: "queued" | "product" | "variant_matrix" | "customization" | "normalization" | "seo" | "image_processing" | "review" | "shopify" | "export" | "captcha";
  completed: number;
  total: number;
  message: string;
  currentAsin?: string;
  errors?: number;
  source?: string;
  items?: AmazonCrawlerProgressItem[];
  browserPool?: AmazonCrawlerBrowserPoolProgress;
}

export type ProductPipelineStatus =
  | "received"
  | "normalizing"
  | "seo"
  | "image_processing"
  | "waiting_review"
  | "sync_queued"
  | "syncing"
  | "shopify_writing"
  | "stopping_after_write"
  | "cancelling"
  | "retry_wait"
  | "completed"
  | "rejected"
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
    performance?: SeoPipelinePerformance;
    status: "pending" | "running" | "completed" | "failed";
    engine?: "gemini" | "heuristic" | "mixed";
    fieldsApplied?: string[];
    fallbackStages?: string[];
    warnings?: string[];
    error?: string | null;
  };
  imageProcessing?: {
    status: "pending" | "running" | "completed" | "failed";
    profileSlug?: string;
    profileRevision?: string;
    processedImages?: number;
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

export interface SeoPipelinePerformance {
  readonly stageDurationsMs: Readonly<Record<string, number>>;
  readonly providerQueueMs?: number;
  readonly providerRequestMs?: number;
  readonly retryWaitMs?: number;
  readonly requestCount?: number;
  readonly retryCount?: number;
  readonly cacheHits?: number;
  readonly revisionRetries?: number;
  readonly commitQueueMs?: number;
  readonly commitMs?: number;
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
    imageProcessingMs?: number;
    imageUploadMs?: number;
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
  status?: "not_found" | "temporarily_blocked" | "network_error" | "invalid_asin" | "parser_error" | "partial";
  reason?: string;
  retryAfter?: string | null;
  stage?: string;
  attempt?: number;
  route?: string | null;
  profile?: string | null;
  elapsedMs?: number;
  isRetryable?: boolean;
  asin?: string;
  httpStatus?: number | null;
  notFoundConfirmed?: boolean;
  message: string;
  retryable: boolean;
  completedAsins?: string[];
  failedAsins?: string[];
  retryableAsins?: string[];
  nonRetryableAsins?: string[];
}

export interface ProductMedia {
  url: string;
  kind: "image" | "video";
  sourceAsin?: string;
  alt?: string;
  amazonImageId?: string | null;
  isMain?: boolean;
  processedUrl?: string;
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
  requestId?: string;
  familyRequestId?: string;
  jobId?: string;
  taskId?: string;
  agentId?: string;
  cacheKey?: string;
  taskAttempt?: number;
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
  asin: string;
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
  status: Extract<AmazonCrawlerJobStatus, "review_pending" | "completed" | "partial" | "cancelled">;
  startedAt: string;
  completedAt: string;
  settings: AmazonCrawlerSettings;
  products: AmazonCrawlerProduct[];
  errors: AmazonCrawlerError[];
  completedAsins?: string[];
  failedAsins?: string[];
  retryableAsins?: string[];
  nonRetryableAsins?: string[];
  warnings: string[];
  statistics: AmazonCrawlerStatistics;
  exportFilename: string | null;
}

export interface AmazonCrawlerRunOptions {
  input: AmazonCrawlerInput;
  onProgress?: (progress: AmazonCrawlerProgress) => void;
  onProducts?: (products: readonly AmazonCrawlerProduct[]) => void;
  onJobCreated?: (jobId: string) => void;
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
  inputs: readonly string[];
  settings: AmazonCrawlerSettings;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  replacementOfJobId: string | null;
  cancellation: AmazonCrawlerCancellationSummary;
}

export interface AmazonCrawlerPendingAgentCancellation {
  clientId: string;
  displayName: string;
  status: AmazonCrawlerClientStatus;
  taskCount: number;
  receivedTaskCount: number;
  hasReceived: boolean;
}

export interface AmazonCrawlerPendingPipelineCancellation {
  itemId: string;
  sourceKey: string;
  phase: ProductPipelineStatus | "pipeline";
  workerId: string | null;
  receivedAt: string | null;
}

export interface AmazonCrawlerCancellationSummary {
  id: string | null;
  requestedAt: string | null;
  pendingAgents: readonly AmazonCrawlerPendingAgentCancellation[];
  pendingPipeline: readonly AmazonCrawlerPendingPipelineCancellation[];
  pendingPipelineItems: number;
  pendingCleanupAgents: readonly {
    clientId: string;
    displayName: string;
    status: string;
    error: string | null;
  }[];
  cacheGeneration: number | null;
  isExecutionConfirmed: boolean;
}

export interface AmazonCrawlerJobController {
  metrics?(jobId?: string): Promise<AmazonCrawlerMetrics>;
  trace?(jobId: string, requestId: string, cursor?: string): Promise<AmazonCrawlerTracePage>;
  list(limit?: number): Promise<readonly AmazonCrawlerJobSnapshot[]>;
  get(jobId: string): Promise<AmazonCrawlerJobSnapshot>;
  cancel(jobId: string, options?: { force?: boolean }): Promise<AmazonCrawlerJobSnapshot>;
  cancelTask(taskId: string): Promise<void>;
  invalidateProductCache(asin: string, amazonZip: string): Promise<AmazonCrawlerCacheClearResult>;
  clearTemporaryData(): Promise<AmazonCrawlerCacheClearResult>;
  replace(jobId: string, input: AmazonCrawlerInput): Promise<AmazonCrawlerJobSnapshot>;
  delete(jobId: string): Promise<void>;
  listDeadLetterTasks?(options?: { jobId?: string; errorCode?: string; limit?: number; offset?: number }): Promise<AmazonCrawlerDeadLetterPage>;
  listTaskAttempts?(taskId: string): Promise<readonly AmazonCrawlerTaskAttempt[]>;
  applyDeadLetterAction?(input: AmazonCrawlerDeadLetterActionInput): Promise<AmazonCrawlerDeadLetterActionResult>;
}

export interface AmazonCrawlerDeadLetterTask {
  taskId: string;
  jobId: string;
  asin: string;
  status: "dead_letter";
  failureCount: number;
  maxRetry: number;
  requeueCount: number;
  attemptCount: number;
  errorCode: string;
  errorMessage: string;
  nextRetryAt: string | null;
  createdAt: string;
  failedAt: string | null;
}

export interface AmazonCrawlerDeadLetterPage {
  items: readonly AmazonCrawlerDeadLetterTask[];
  total: number;
  limit: number;
  offset: number;
}

export interface AmazonCrawlerTaskAttempt {
  attemptId: string;
  taskId: string;
  jobId: string | null;
  clientId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  agentVersion: string;
  crawlerVersion: string;
  parserVersion: string;
  leasedAt: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  archived: boolean;
}

export interface AmazonCrawlerDeadLetterActionInput {
  action: "requeue" | "delete";
  requestId: string;
  taskIds?: readonly string[];
  jobId?: string;
  errorCode?: string;
  expectedCount: number;
  reason: string;
}

export interface AmazonCrawlerDeadLetterActionResult {
  action: "requeue" | "delete";
  changed: number;
  taskIds: readonly string[];
  jobId: string | null;
  errorCode: string | null;
}

export interface AmazonCrawlerAgentObservability {
  cache: Readonly<Record<string, number>>;
  resources: {
    rssBytes?: number;
    browserProcesses?: number;
    browserContexts?: number;
    browserPages?: number;
    processCount?: number;
    isComplete: boolean;
  };
  backlog: number;
  dropped: number;
  sampledAt?: string;
}

export interface AmazonCrawlerMetrics {
  windowStartedAt: string;
  retainedSince: string | null;
  sampledAt: string;
  jobId: string | null;
  counts: {
    familyCacheHits: number;
    familyCacheMisses: number;
    httpAttempts: number;
    httpSuccesses: number;
    browserAttempts: number;
    pageFetches: number;
    playwrightFallbacks: number;
    captchaAttempts: number;
    familyAttempts: number;
    partialFamilies: number;
    parserFailures: number;
    networkRetries: number;
    taskRetries: number;
    retryCount: number;
  };
  rates: { cacheHit: number | null; httpSuccess: number | null; playwrightFallback: number | null; captcha: number | null };
  averageCrawlDurationMs: number | null;
  queue: { crawl: number; crawlActive: number; pipeline: number };
  agents: Array<AmazonCrawlerAgentObservability & { agentId: string; displayName: string }>;
}

export interface AmazonCrawlerTraceEvent {
  eventId: string;
  event: string;
  timestamp: string;
  requestId: string;
  familyRequestId: string;
  jobId: string;
  taskId: string;
  agentId: string;
  asin: string;
  stage?: string;
  route?: string;
  profile?: string;
  cacheKey?: string;
  attempt?: number;
  taskAttempt?: number;
  durationMs?: number;
  result: string;
  error?: string;
}

export interface AmazonCrawlerTracePage {
  events: AmazonCrawlerTraceEvent[];
  nextCursor: string | null;
}

export interface AmazonCrawlerRunner {
  (options: AmazonCrawlerRunOptions): Promise<AmazonCrawlerOutput>;
}

export type AmazonCrawlerReviewDecision = "pending" | "approved" | "rejected";

export type AmazonCrawlerReviewSyncStatus = "idle" | "queued" | "syncing" | "synced" | "failed";

export interface AmazonCrawlerReviewTarget {
  readonly collectionIds: readonly string[];
  readonly productType?: string;
  readonly priceAddition: number;
  readonly discountPercent: number;
}

export interface AmazonCrawlerReviewItem {
  readonly id: string;
  readonly jobId: string;
  readonly sourceKey: string;
  readonly storeId: string;
  readonly decision: AmazonCrawlerReviewDecision;
  readonly syncStatus: AmazonCrawlerReviewSyncStatus;
  readonly version: number;
  readonly rejectionReason?: string | null;
  readonly syncError?: string | null;
  readonly readyAt?: string | null;
  readonly updatedAt?: string | null;
  readonly target: AmazonCrawlerReviewTarget;
  readonly product: AmazonCrawlerProduct;
}

export interface AmazonCrawlerReviewEditPatch {
  readonly productTitle?: string;
  readonly productDescription?: string;
  readonly seoTitle?: string;
  readonly seoDescription?: string;
  readonly handle?: string;
  readonly imageAlts?: readonly { readonly id: string; readonly alt: string }[];
}

export interface AmazonCrawlerReviewClient {
  list(): Promise<readonly AmazonCrawlerReviewItem[]>;
  subscribe(onItems: (items: readonly AmazonCrawlerReviewItem[]) => void): () => void;
  update(itemId: string, expectedVersion: number, patch: AmazonCrawlerReviewEditPatch): Promise<AmazonCrawlerReviewItem>;
  decide(itemId: string, expectedVersion: number, decision: AmazonCrawlerReviewDecision, reason?: string): Promise<AmazonCrawlerReviewItem>;
  sync(itemId: string): Promise<AmazonCrawlerReviewItem>;
  syncAllApproved(): Promise<{ readonly queued: number; readonly itemIds: readonly string[] }>;
  markSynced(itemId: string, info?: { productId?: string; productHandle?: string; adminUrl?: string }): Promise<AmazonCrawlerReviewItem>;
  markFailed(itemId: string, error?: string): Promise<AmazonCrawlerReviewItem>;
  delete(itemId: string): Promise<{ readonly deleted: boolean }>;
  deleteAll(): Promise<{ readonly deleted: number; readonly skipped: number }>;
  imageUrl(fileToken: string): string;
}

export interface AmazonCrawlerCacheClearResult {
  removedFiles: number;
  removedBytes: number;
  requestedClients?: number;
  respondedClients?: number;
  failedClients?: number;
  discardedJobs?: number;
}

export interface AmazonCrawlerCacheClearer {
  (): Promise<AmazonCrawlerCacheClearResult>;
}

export type AmazonCrawlerClientStatus = "online" | "offline" | "busy" | "waiting_captcha" | "paused" | "degraded";

export interface AmazonCrawlerWorkerHealth {
  state: "healthy" | "degraded";
  failuresInWindow: number;
  failureLimit: number;
  windowSeconds: number;
  configuredConcurrency: number;
  effectiveConcurrency: number;
}

export interface AmazonCrawlerClientSummary {
  id: string;
  displayName: string;
  agentVersion: string;
  status: AmazonCrawlerClientStatus;
  isConnected: boolean;
  maxConcurrentInputs: number;
  activeTasks: number;
  leasedTasks: number;
  availableSlots: number;
  lastSeenAt: string | null;
  desiredExecutionState?: "RUNNING" | "PAUSED";
  appliedExecutionState?: "RUNNING" | "PAUSED";
  commandSequence?: number;
  lastProcessedCommandSequence?: number;
  desiredConfigVersion?: number;
  appliedConfigVersion?: number;
  desiredAgentConfig?: AmazonCrawlerAgentRuntimeConfig;
  observability?: {
    workerHealth?: AmazonCrawlerWorkerHealth;
  };
}

export interface AmazonCrawlerAgentRuntimeConfig {
  maxConcurrentInputs: number;
  heartbeatIntervalSeconds: number;
  clientOfflineAfterSeconds: number;
  leaseSeconds: number;
  limits: {
    productThreads: number;
    variantThreads: number;
    urllibThreads: number;
    browserProfiles: number;
    browserTabs: number;
    headless: boolean;
  };
}

export const DEFAULT_AMAZON_CRAWLER_AGENT_CONFIG: AmazonCrawlerAgentRuntimeConfig = {
  maxConcurrentInputs: 4,
  heartbeatIntervalSeconds: 10,
  clientOfflineAfterSeconds: 30,
  leaseSeconds: 60,
  limits: {
    productThreads: 4,
    variantThreads: 8,
    urllibThreads: 12,
    browserProfiles: 4,
    browserTabs: 2,
    headless: false,
  },
};

export interface AmazonCrawlerAgentCommandEvent {
  status: string;
  at: string | null;
  detail: Readonly<Record<string, unknown>>;
}

export interface AmazonCrawlerAgentCommandSummary {
  commandId: string;
  sequence: number;
  type: "PAUSE" | "RESUME" | "RELOAD_CONFIG" | "DRAIN" | "RUN_SELF_TEST" | "UPDATE_AGENT" | "ROLLBACK_AGENT" | "PURGE_PENDING_TASKS" | "PURGE_ALL_LOCAL_TASKS" | "RESTART_WORKERS" | "RESTART_AGENT";
  status: string;
  createdAt: string | null;
  error: string | null;
  events: readonly AmazonCrawlerAgentCommandEvent[];
}

export interface AmazonCrawlerCommandController {
  submit(agentId: string, type: "PAUSE" | "RESUME"): Promise<void>;
  previewPendingPurge(agentId: string, taskIds: readonly string[]): Promise<AmazonCrawlerPendingPurgePreview>;
  purgePending(agentId: string, taskIds: readonly string[], expectedPendingCount: number, reason: string): Promise<void>;
  previewPurgeAllLocal(agentId: string): Promise<AmazonCrawlerPendingPurgePreview>;
  purgeAllLocal(agentId: string, expectedPendingCount: number, reason: string): Promise<void>;
  restart(agentId: string, type: "RESTART_WORKERS" | "RESTART_AGENT", reason: string): Promise<void>;
  reloadConfig(agentId: string, config: AmazonCrawlerAgentRuntimeConfig): Promise<void>;
  history(agentId: string): Promise<readonly AmazonCrawlerAgentCommandSummary[]>;
}

export interface AmazonCrawlerPendingPurgePreview {
  scope: "pending" | "all-local";
  requestedCount: number;
  pendingCount: number;
  eligibleTaskIds: readonly string[];
  ineligibleCount: number;
}

export interface AmazonCrawlerAdmissionGate {
  state: "OPEN" | "STOPPED";
  scope: "crawler";
  revision: number;
  actor: string | null;
  reason: string | null;
  updatedAt: string | null;
  confirmedAgents: number;
  pendingAgents: number;
  confirmations: readonly AmazonCrawlerAdmissionConfirmation[];
}

export interface AmazonCrawlerAdmissionConfirmation {
  agentId: string;
  displayName: string;
  isConnected: boolean;
  state: "OPEN" | "STOPPED";
  revision: number;
  status: "confirmed" | "pending_confirmation";
}

export interface AmazonCrawlerAdmissionGateController {
  load(): Promise<AmazonCrawlerAdmissionGate>;
  setState(state: "OPEN" | "STOPPED", reason: string): Promise<AmazonCrawlerAdmissionGate>;
}

export interface AmazonCrawlerClientsLoader {
  (): Promise<AmazonCrawlerClientSummary[]>;
}

export interface AmazonCrawlerAgentRelease {
  version: string;
  downloadUrl: string;
  checksumUrl: string;
  releasePageUrl: string;
  fileName: string;
  sizeBytes: number;
  publishedAt: string;
}

export interface AmazonCrawlerAgentReleaseLoader {
  (): Promise<AmazonCrawlerAgentRelease>;
}

export interface AmazonCrawlerJobSummary {
  id: string;
  status: AmazonCrawlerJobStatus;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  acceptedInputs: number;
  productCounts?: Record<string, number>;
  progress?: AmazonCrawlerProgress;
}

export interface AmazonCrawlerHydratedJob {
  jobId: string;
  status: AmazonCrawlerJobStatus;
  progress?: AmazonCrawlerProgress;
  products: AmazonCrawlerProduct[];
  output?: AmazonCrawlerOutput | null;
  settings?: AmazonCrawlerSettings;
}

export interface AmazonCrawlerJobLoader {
  loadJob(jobId?: string): Promise<AmazonCrawlerHydratedJob | null>;
  listRecentJobs(limit?: number): Promise<AmazonCrawlerJobSummary[]>;
}

export type AmazonCrawlerHandoverHandler = (
  products: readonly AmazonCrawlerProduct[],
) => Promise<void> | void;

export interface ImageProcessingProfile {
  slug: string;
  name: string;
  enabled: boolean;
  revision: string;
  hasLogo: boolean;
  logoUrl?: string;
  randomPixels: number;
  pixelDelta: number;
  jpegQuality: number;
  output: {
    width: number;
    height: number;
    fit: "contain" | "cover";
    upscale: boolean;
    background: string;
  };
  logo: {
    enabled: boolean;
    width: number;
    height: number;
    maxPercent: number;
    percentBasis: "width" | "height";
    padding: number;
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    opacity: number;
  };
}

export interface ImageProcessingProfileManager {
  list(): Promise<ImageProcessingProfile[]>;
  save(slug: string, profile: ImageProcessingProfile): Promise<ImageProcessingProfile>;
  delete(slug: string): Promise<void>;
  uploadLogo(slug: string, dataUrl: string): Promise<ImageProcessingProfile>;
  preview(slug: string, profile: ImageProcessingProfile, dataUrl: string): Promise<string>;
}

export const DEFAULT_AMAZON_CRAWLER_SETTINGS: AmazonCrawlerSettings = {
  profileSlug: "default",
  imageProfileSlug: "default",
  applyJeminisePreset: false,
  productThreads: 3,
  variantThreads: 8,
  urllibThreads: 12,
  browserProfiles: 4,
  browserTabs: 2,
  headless: false,
  amazonZip: "90001",
  captchaTimeoutSeconds: 180,
  dnsTimeoutSeconds: 10,
  connectTimeoutSeconds: 15,
  httpResponseTimeoutSeconds: 90,
  navigationTimeoutSeconds: 60,
  selectorTimeoutSeconds: 15,
  customizationTimeoutSeconds: 120,
  childTimeoutSeconds: 300,
  asinTimeoutSeconds: 1800,
  jobTimeoutSeconds: 21600,
  maxMatrixVariants: 500,
  storeId: "capozen",
  priceAddition: 0,
  discountPercent: 0,
  collectionId: "",
  collectionIds: [],
  productType: "",
};
