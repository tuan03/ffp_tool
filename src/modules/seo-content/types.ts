export interface SeoContentImageInput {
  readonly id?: string;
  readonly url: string;
  readonly alt?: string;
  readonly localFilePath?: string;
}

export interface SeoContentInput {
  readonly images: readonly SeoContentImageInput[];
  /** Public storefront domain used to infer the workflow niche before B1. */
  readonly siteDomain?: string;
  readonly niche: string;
  readonly title: string;
  readonly description: string;
  readonly handle: string;
  readonly productId?: string;
  readonly url?: string;
  readonly storeId?: string;
  readonly variantLabel?: string;
}

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

export interface SeoContentOutput {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly images: readonly SeoContentImageOutput[];
  readonly productHandle: string;
}

export type SeoContentEngine = "gemini" | "heuristic" | "mixed";

export interface SeoContentRunMetadata {
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
  readonly productHandle: string;
}

export interface SeoContentAltOnlyDetailedOutput {
  readonly output: SeoContentAltOnlyOutput;
  readonly metadata: SeoContentRunMetadata;
}

export type SeoContentDetailedResult = SeoContentDetailedOutput | SeoContentAltOnlyDetailedOutput;

export interface SeoContentPipelineSummary {
  readonly status: "completed";
  readonly engine: SeoContentEngine;
  readonly fieldsApplied: readonly string[];
  readonly fallbackStages: readonly string[];
  readonly warnings: readonly string[];
}

export interface SeoContentDependencies {
  readonly conflictCorpus?: unknown;
}

export interface SeoContentRunOptions {
  readonly imageMode?: "full" | "alt_only";
  readonly signal?: AbortSignal;
  readonly dependencies?: SeoContentDependencies;
}
