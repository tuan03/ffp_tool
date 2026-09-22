import type { SeoContentImageOutput, SeoContentInput } from "../types";
import type { StoredEmbedding } from "./conflict-control/seo-conflict-corpus";

export type SeoStageName = "b1" | "b2" | "b3" | "b4" | "b5" | "b6";

/** B1: Kết quả phân tích sản phẩm và hình ảnh (OCR, Vision, Theme) */
export interface ProductUnderstanding {
  readonly ocrTexts: readonly string[];
  readonly detectedEntities: readonly string[];
  readonly dominantColors: readonly string[];
  readonly visualStyle: string;
  readonly productCategory: string;
}

/** B2: Bối cảnh mua sắm, chân dung khách hàng & dịp sử dụng */
export interface ShoppingContext {
  readonly targetAudience: readonly string[];
  readonly suitableOccasions: readonly string[];
  readonly useCases: readonly string[];
  readonly buyerIntentKeywords: readonly string[];
}

/** B3: Tập dữ liệu nghiên cứu từ khóa mở rộng (Google Suggest, Long-tail) */
export interface SearchResearchResult {
  readonly seedKeywords: readonly string[];
  readonly suggestedQueries: readonly string[];
  readonly querySources: Readonly<Record<string, string>>;
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
}

/** B6: Kết quả tối ưu hóa hình ảnh (WebP & Alt Text) */
export interface ImageProcessingResult {
  readonly processedImages: readonly SeoContentImageOutput[];
}

/** Context tích lũy chạy xuyên suốt qua 6 Stage của Pipeline */
export interface SeoPipelineContext {
  readonly source: SeoContentInput;
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
  readonly searchResearch?: SearchResearchResult;
  readonly conflictResult?: ConflictResult;
  readonly contentResult?: ContentResult;
  readonly imageResult?: ImageProcessingResult;
}

/** Interface đại diện cho một stage trong pipeline */
export interface SeoPipelineStage {
  readonly name: SeoStageName;
  execute(context: SeoPipelineContext): Promise<SeoPipelineContext>;
}
