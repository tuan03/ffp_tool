import type {
  SeoCatalogOffering,
  SeoCatalogPolicy,
  SeoContentGenerationInput,
  SeoContentImageInput,
  SeoExecutionEnvelope,
  SeoProductDescriptionPolicy,
  SeoStoreProfile,
} from "../../shared/seo-content-contract";

export type {
  SeoCatalogOffering,
  SeoCatalogPolicy,
  SeoContentImageInput,
  SeoExecutionEnvelope,
  SeoProductDescriptionPolicy,
  SeoStoreProfile,
};

export interface VariantSample {
  readonly title: string;
  readonly price?: string;
  readonly sku?: string;
  readonly options?: Readonly<Record<string, string>>;
}

export interface VariantSummary {
  readonly variantCount: number;
  readonly optionNames: readonly string[];
  readonly sampleVariants: readonly VariantSample[];
  readonly minPrice?: number;
  readonly maxPrice?: number;
}

export interface SeoContentInput extends SeoContentGenerationInput {}

export interface SeoContentWebpAsset {
  readonly filename: string;
  readonly localFilePath?: string;
  readonly url?: string;
  readonly data?: Buffer | Uint8Array | Blob;
}

export interface SeoContentImageOutput {
  readonly sourceUrl: string;
  readonly alt: string;
  readonly webp: SeoContentWebpAsset;
}

export interface GeneratedFaqItem {
  readonly question: string;
  readonly answer: string;
}

export interface SeoContentOutput {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly images: readonly SeoContentImageOutput[];
  /** @deprecated Operational Review compatibility only; generation must not propose handle changes. */
  readonly productHandle?: string;
  readonly aeo_quick_summary?: string;
  readonly aeo_faq?: readonly GeneratedFaqItem[];
  readonly aeo_json_ld?: string;
}

export type SeoContentEngine =
  | "gemini"
  | "heuristic"
  | "mixed"
  | /** @deprecated */ "custom_gpt"
  | "codex_mcp";

export interface SeoPerformanceMetrics {
  readonly revisionRetries?: number;
  readonly commitQueueMs?: number;
  readonly commitMs?: number;
  readonly stageDurationsMs: Readonly<Record<string, number>>;
  readonly providerQueueMs?: number;
  readonly providerRequestMs?: number;
  readonly retryWaitMs?: number;
  readonly requestCount?: number;
  readonly retryCount?: number;
  readonly cacheHits?: number;
}

export interface SeoContentRunMetadata {
  readonly performance?: SeoPerformanceMetrics;
  readonly engine: SeoContentEngine;
  readonly fieldsApplied: readonly string[];
  readonly fallbackStages: readonly string[];
  readonly warnings: readonly string[];
  readonly approvedKeywords: readonly string[];
  readonly approvedEmbeddings?: Readonly<Record<string, {
    readonly values: readonly number[];
    readonly provider: string;
    readonly model: string;
    readonly taskType: string;
    readonly dimensions: number;
    readonly vectorSpaceId?: string;
    readonly reusableAcrossRuns?: boolean;
  }>>;
  readonly corpusRevision?: number;
  readonly inputHash?: string;
  readonly sourceVersion?: string;
  readonly shopifyUpdatedAt?: string;
  readonly providerId?: string;
  readonly pipelineVersion?: string;
}

export interface SeoContentDetailedOutput {
  readonly output: SeoContentOutput;
  readonly metadata: SeoContentRunMetadata;
}

export interface SeoContentAltOnlyImageOutput {
  readonly sourceUrl: string;
  readonly alt: string;
}

export interface SeoContentAltOnlyOutput {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly images: readonly SeoContentAltOnlyImageOutput[];
  /** @deprecated Operational Review compatibility only; generation must not propose handle changes. */
  readonly productHandle?: string;
  readonly aeo_quick_summary?: string;
  readonly aeo_faq?: readonly GeneratedFaqItem[];
  readonly aeo_json_ld?: string;
}

export interface SeoContentAltOnlyDetailedOutput {
  readonly output: SeoContentAltOnlyOutput;
  readonly metadata: SeoContentRunMetadata;
}

export type SeoContentDetailedResult = SeoContentDetailedOutput | SeoContentAltOnlyDetailedOutput;

export interface SeoContentPipelineSummary {
  readonly status: "completed";
  readonly performance?: SeoPerformanceMetrics;
  readonly engine: SeoContentEngine;
  readonly fieldsApplied: readonly string[];
  readonly fallbackStages: readonly string[];
  readonly warnings: readonly string[];
}

export interface SeoContentDependencies {
  readonly conflictCorpus?: unknown;
  readonly checkpointManager?: unknown;
  readonly checkpointStore?: unknown;
  readonly providerRegistry?: unknown;
  readonly siteNicheResolver?: unknown;
  readonly resultCache?: unknown;
  readonly providerCircuitBreaker?: unknown;
}

export interface SeoContentRunOptions {
  readonly imageMode?: "full" | "alt_only";
  readonly signal?: AbortSignal;
  /** Operational identity/version data. It must never be projected into generation prompts. */
  readonly execution?: SeoExecutionEnvelope;
  readonly dependencies?: SeoContentDependencies;
  readonly stageTimeouts?: Partial<Record<string, number>>;
  readonly overallTimeoutMs?: number;
}

