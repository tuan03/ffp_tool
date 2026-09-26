import type { GeneratedFaqItem, SeoContentImageOutput, SeoContentInput } from "../types";
import type { StoredEmbedding } from "./conflict-control/seo-conflict-corpus";
import type { StoreContentProfile } from "./store-profiles/types";

export type SeoStageName = "b1" | "b2" | "b3" | "b4" | "b5" | "b6";

/** B1: Evidence anchored to the sold product; never a Shopify taxonomy mapping. */
export interface ProductUnderstanding {
  readonly typography: {
    readonly visibleTexts: readonly string[];
    readonly styleSummary: string;
  };
  readonly visualEntities: string;
  readonly sceneContext: string;
  readonly physicalProductIdentity: string;
}

/** B2: Bối cảnh mua sắm, chân dung khách hàng & dịp sử dụng */
export interface ShoppingContext {
  readonly targetAudience: readonly string[];
  readonly suitableOccasions: readonly string[];
  readonly useCases: readonly string[];
  readonly buyerIntentKeywords: readonly string[];
  /** Scene-derived discovery clues, deliberately excluded from grounded product facts. */
  readonly contextualAudienceHints?: readonly string[];
  readonly sceneSearchSeeds?: readonly string[];
}

/** B3: Tập dữ liệu nghiên cứu từ khóa mở rộng (Google Suggest, Long-tail) */
export interface SearchResearchResult {
  readonly seedKeywords: readonly string[];
  readonly suggestedQueries: readonly string[];
  readonly querySources: Readonly<Record<string, string>>;
  /** Actual Google Autocomplete requests. Probe variants are discovery-only. */
  readonly autocompleteProbes?: readonly AutocompleteProbe[];
}

export interface AutocompleteProbe {
  readonly query: string;
  readonly parentSeed: string;
  readonly kind: "original" | "gemini_variant";
}

export interface KeywordCluster {
  readonly representative: string;
  readonly members: readonly string[];
}

export interface ConflictDetail {
  readonly reason: string;
  readonly conflictingProductKey?: string;
  readonly conflictingHandle?: string;
  readonly conflictingUrl?: string;
  readonly conflictingTitle?: string;
  readonly conflictingKeyword?: string;
  readonly matchType?: "exact" | "semantic";
  readonly similarity?: number;
}

/** B4: Kết quả kiểm tra xung đột và trùng lặp từ khóa */
export interface ConflictResult {
  readonly approvedKeywords: readonly string[];
  readonly discardedKeywords: readonly string[];
  readonly conflictReasons: Readonly<Record<string, string>>;
  readonly relevanceScores?: Readonly<Record<string, number>>;
  readonly keywordClusters?: readonly KeywordCluster[];
  readonly conflictDetails?: Readonly<Record<string, ConflictDetail>>;
  readonly corpusRevision?: number;
  readonly approvedEmbeddings?: Readonly<Record<string, StoredEmbedding>>;
}

/** B5: Kết quả sáng tạo nội dung văn bản (Copywriting) */
export interface ContentResult {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly productHandle: string;
  readonly aeo_quick_summary?: string;
  readonly aeo_faq?: readonly GeneratedFaqItem[];
  readonly aeo_json_ld?: string;
}

/** B5: Metadata nội bộ về từ khóa và cơ chế sinh nội dung */
export interface ContentGenerationMetadata {
  readonly primaryKeyword?: string;
  readonly secondaryKeywords: readonly string[];
  readonly supportingKeywords: readonly string[];
  readonly targetedKeywords: readonly string[];
  readonly generator: "gemini" | "heuristic";
  readonly corpusRevision?: number;
}

import type { ImageProcessingMetadata } from "./image-processing/image-processing-types";

/** B6: Kết quả tối ưu hóa hình ảnh (WebP & Alt Text) */
export interface ImageProcessingResult {
  readonly processedImages: readonly SeoContentImageOutput[];
}

/** Context tích lũy chạy xuyên suốt qua 6 Stage của Pipeline */
export interface SeoPipelineContext {
  readonly source: SeoContentInput;
  /** Derived from the storefront homepage; source.niche remains the fallback input. */
  readonly effectiveNiche?: string;
  readonly storeProfile?: StoreContentProfile;
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
  readonly searchResearch?: SearchResearchResult;
  readonly conflictResult?: ConflictResult;
  readonly contentResult?: ContentResult;
  readonly contentGenerationMetadata?: ContentGenerationMetadata;
  readonly imageResult?: ImageProcessingResult;
  readonly imageProcessingMetadata?: ImageProcessingMetadata;
}

/** Interface đại diện cho một stage trong pipeline */
export interface SeoPipelineStage {
  readonly name: SeoStageName;
  execute(context: SeoPipelineContext): Promise<SeoPipelineContext>;
}
