import type { AppEnvironment } from "../../shared/types";

export type { AppEnvironment };

/** Supported product types for Pinterest POD pipeline */
export type PodProductType = "bag" | "rug" | "blanket" | "custom";
export type PinterestProductType = PodProductType;

/**
 * Automatically infers product type ('bag', 'blanket', 'rug', or 'custom') from niche keywords:
 * - If niche contains 'bag', 'tote', 'backpack', 'purse', 'satchel' -> 'bag' (preset 4500x5400 px)
 * - If niche contains 'blanket', 'throw', 'quilt' -> 'blanket' (preset 10000x11000 px)
 * - If niche contains 'rug', 'carpet', 'mat' -> 'rug' (preset 4000x6400 px)
 * - If niche contains 'custom' -> 'custom' (preset 4000x6400 px)
 * - Otherwise -> 'custom' (preset 4000x6400 px)
 */
export function inferProductTypeFromNiche(niche: string): PodProductType {
  const lower = (niche ?? "").toLowerCase().trim();
  if (lower.includes("bag") || lower.includes("tote") || lower.includes("backpack") || lower.includes("purse") || lower.includes("satchel")) {
    return "bag";
  }
  if (lower.includes("blanket") || lower.includes("throw") || lower.includes("quilt")) {
    return "blanket";
  }
  if (lower.includes("rug") || lower.includes("carpet") || lower.includes("mat")) {
    return "rug";
  }
  if (lower.includes("custom")) {
    return "custom";
  }
  return "custom";
}

/** Workflow stage for job execution */
export type PodWorkflowStage = "crawl_and_review" | "full_pipeline" | "produce" | "full";
export type WorkflowStage = PodWorkflowStage;

/** Job lifecycle status */
export type PodJobStatus =
  | "idle"
  | "running"
  | "ready_for_review"
  | "producing"
  | "completed"
  | "failed"
  | "cancelled";
export type JobStatus = PodJobStatus;

/** Reference room image provided by Main UI for lifestyle mockup placement */
export interface PodReferenceImage {
  readonly id: string;
  readonly url: string;
  readonly name?: string;
}
export type ReferenceImage = PodReferenceImage;

export interface PodCandidate {
  readonly id: string;
  readonly candidate_id?: string;
  readonly image_id?: string;
  readonly pin_id?: string;
  readonly title: string;
  readonly query?: string;
  readonly trend?: string;
  readonly pin_url: string;
  readonly image_url: string;
  readonly thumbnail_url?: string;
  readonly local_filename?: string;
  readonly local_path?: string;
  readonly motifs?: readonly string[];
  readonly image_score: number;
  readonly printability_score: number;
  readonly flat_artwork_score: number;
  readonly is_direct_printable: boolean;
  readonly is_breakthrough_concept?: boolean;
  readonly candidate_category?: "direct_printable" | "breakthrough_concept" | "rejected";
  readonly is_rejected?: boolean;
  readonly reject_reason?: string;
  readonly reject_reason_code?: string;
  readonly recommended: boolean;
  readonly reason: string;
}
export type CandidateItem = PodCandidate;

/** Keyword item with growth metrics from Pinterest API */
export interface TrendingKeywordItem {
  readonly keyword: string;
  readonly rank?: number;
  readonly pct_growth_mom?: number;
  readonly pct_growth_wow?: number;
  readonly pct_growth_yoy?: number;
  readonly monthly_searches?: number;
  readonly is_accepted?: boolean;
  readonly status?: "accepted" | "rejected";
  readonly reject_reason?: string;
  readonly reject_reason_code?: string;
  readonly suggested_fused_query?: string;
}

/** 3-5 Diverse Theme Cluster synthesized by AI */
export interface ThemeCluster {
  readonly cluster_id: string;
  readonly id?: string;
  readonly cluster_name?: string;
  readonly theme_name?: string;
  readonly theme_name_vi?: string;
  readonly description?: string;
  readonly visual_style?: string;
  readonly keywords?: readonly TrendingKeywordItem[];
  readonly sample_motifs?: readonly string[];
  readonly sample_queries?: readonly string[];
  readonly fused_queries?: readonly string[];
  readonly avg_growth_mom?: number;
  readonly avg_growth_wow?: number;
  readonly growth_mom_avg?: number;
  readonly recommended?: boolean;
  readonly selected?: boolean;
}

/** Trend Discovery Input */
export interface TrendDiscoveryInput {
  readonly niche: string;
  readonly product?: PinterestProductType | string;
  readonly trend_type?: "growing" | "seasonal" | "monthly" | string;
  readonly interest?: string;
  readonly interests?: string;
  readonly region?: "US" | "GB" | "CA" | "DE" | string;
}

/** Trend Discovery Result */
export interface TrendDiscoveryResult {
  readonly ok: boolean;
  readonly niche: string;
  readonly product?: string;
  readonly region?: string;
  readonly trend_type?: string;
  readonly clusters: readonly ThemeCluster[];
  readonly all_keywords?: readonly TrendingKeywordItem[];
  readonly accepted_keywords?: readonly TrendingKeywordItem[];
  readonly rejected_keywords: readonly TrendingKeywordItem[];
  readonly total_keywords: number;
  readonly accepted_count?: number;
  readonly rejected_count?: number;
}

/** Stepper progress information for UI display */
export interface PodJobStepper {
  readonly current_step: number;
  readonly percent: number;
  readonly current_message: string;
}
export type StepperState = PodJobStepper;

/** Summary metrics for final deliverables showcase */
export interface PodSummaryMetrics {
  readonly rgb_4k_count: number;
  readonly cmyk_count: number;
  readonly lifestyle_mockup_count: number;
  readonly cutouts_count: number;
  readonly mockups_count: number;
}
export type SummaryMetrics = PodSummaryMetrics;

/** Generic asset item returned in job deliverables */
export interface PodAssetInfo {
  readonly filename: string;
  readonly url: string;
  readonly download_url?: string;
  readonly name?: string;
  readonly bytes?: number;
  readonly width_px?: number;
  readonly height_px?: number;
  readonly dpi?: number;
  readonly color_mode?: string;
  readonly is_primary?: boolean;
  readonly scene_type?: string;
  readonly scene_description?: string;
}

export type DeliverablePrintImage = PodAssetInfo;
export interface DeliverableLifestyleMockup extends PodAssetInfo {
  readonly scene_type: string;
  readonly scene_description: string;
}
export type DeliverableCutout = PodAssetInfo;

/** 4-step comparison row for review and SEO alignment */
export interface PodComparisonRow {
  readonly index: number;
  readonly product_label: string;
  readonly status?: string;
  readonly reason?: string;
  readonly source_url: string;
  readonly cutout_url?: string;
  readonly cutout_white_url?: string;
  readonly final_print_url: string;
  readonly ai_background_urls: readonly string[];
}
export type ComparisonRow = PodComparisonRow;

/** Raw backend deliverables container */
export interface PodBackendDeliverables {
  readonly print_cmyk_images?: readonly PodAssetInfo[];
  readonly final_png_images?: readonly PodAssetInfo[];
  readonly lifestyle_mockups?: readonly PodAssetInfo[];
  readonly product_cutouts?: readonly PodAssetInfo[];
  readonly product_cutouts_white?: readonly PodAssetInfo[];
  readonly perspective_mockups?: readonly PodAssetInfo[];
  readonly comparison_rows?: readonly PodComparisonRow[];
  readonly comparison_matrix?: readonly PodComparisonRow[];
  readonly report_url?: string;
  readonly has_report?: boolean;
  readonly rug_shape?: string;
  readonly summary_metrics?: PodSummaryMetrics;
  readonly print_spec?: Record<string, unknown>;
  readonly storefront_spec?: Record<string, unknown>;
  readonly standard_badge?: string;
}

export interface DeliverablesData {
  readonly print_cmyk_images?: readonly DeliverablePrintImage[];
  readonly final_png_images?: readonly DeliverablePrintImage[];
  readonly lifestyle_mockups?: readonly DeliverableLifestyleMockup[];
  readonly product_cutouts_white?: readonly DeliverableCutout[];
  readonly comparison_rows?: readonly ComparisonRow[];
}

export interface PinterestTokenInfo {
  readonly has_access_token: boolean;
  readonly has_refresh_token: boolean;
  readonly expires_at?: number;
  readonly username?: string | null;
  readonly source?: string;
}

/** Pinterest authentication status response */
export interface PinterestAuthStatus {
  readonly ok: boolean;
  readonly logged_in: boolean;
  readonly browser_logged_in?: boolean;
  readonly oauth_valid?: boolean;
  readonly status_text: string;
  readonly profile_dir?: string;
  readonly profile_exists?: boolean;
  readonly oauth_file_exists?: boolean;
  readonly auth_url?: string;
  readonly redirect_uri?: string;
  readonly app_id_configured?: boolean;
  readonly token_info?: PinterestTokenInfo | null;
}

export interface SavePinterestTokenPayload {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly scopes?: string;
  readonly code?: string;
  readonly url?: string;
  readonly redirect_uri?: string;
}

export interface SavePinterestTokenResponse {
  readonly ok: boolean;
  readonly message?: string;
  readonly username?: string;
  readonly business_name?: string;
  readonly saved_path?: string;
  readonly expires_at?: number;
}

/** Payload for launching Pinterest browser login */
export interface PinterestLaunchLoginPayload {
  readonly timeout?: number;
}

/** Response from launching Pinterest browser login */
export interface PinterestLaunchLoginResponse {
  readonly ok: boolean;
  readonly status_text: string;
  readonly message?: string;
  readonly status?: string;
  readonly logged_in?: boolean;
  readonly pid?: number;
  readonly error?: string;
}
export type PinterestLaunchLoginOutput = PinterestLaunchLoginResponse;

/** Stage 1: Input parameters for Pinterest crawl & discovery */
export interface PinterestDiscoveryInput {
  readonly niche: string;
  readonly product?: PodProductType;
  readonly workflow_stage?: PodWorkflowStage;
  readonly trend_type?: "growing" | "seasonal" | "monthly" | string;
  readonly interest?: string;
  readonly interests?: string;
  readonly region?: "US" | "GB" | "CA" | "DE" | string;
  readonly selected_clusters?: readonly string[] | readonly ThemeCluster[];
  readonly custom_queries?: readonly string[];
  readonly candidatePoolSize?: number;
  readonly task5_max_downloads?: number;
  readonly top_images?: number;
  readonly referenceImages?: readonly PodReferenceImage[];
  readonly ai_background_variants?: number;
}
export type CreateJobInput = PinterestDiscoveryInput;

/** Stage 1: Output returned when candidate discovery is complete */
export interface PinterestDiscoveryOutput {
  readonly ok: boolean;
  readonly jobId: string;
  readonly status: PodJobStatus;
  readonly total_candidates: number;
  readonly stepper: PodJobStepper;
  readonly logs: readonly string[];
  readonly candidates: readonly PodCandidate[];
  readonly rejected_candidates?: readonly PodCandidate[];
  readonly clusters?: readonly ThemeCluster[];
}

export interface CreateJobOutput {
  readonly ok: boolean;
  readonly jobId: string;
  readonly job_id?: string;
  readonly status: JobStatus;
  readonly logs?: readonly string[];
}

/** Stage 2: Input parameters for producing selected candidate mockups and print files */
export interface PinterestProductionInput {
  readonly jobId: string;
  readonly selected_candidates: readonly string[];
  readonly product?: PodProductType;
  readonly niche?: string;
  readonly candidates?: readonly PodCandidate[];
  readonly design_mode?: "direct_print" | "ai-artwork" | string;
  readonly referenceImages?: readonly ReferenceImage[];
  readonly room_template_urls?: readonly string[];
  readonly ai_background_variants?: number;
}
export type ProduceInput = PinterestProductionInput;

/** Stage 2: Output returned when production render is complete */
export interface PinterestProductionOutput {
  readonly ok: boolean;
  readonly jobId: string;
  readonly status: PodJobStatus;
  readonly stepper: PodJobStepper;
  readonly logs: readonly string[];
  readonly summaryMetrics: PodSummaryMetrics;
  readonly deliverables: PodBackendDeliverables;
  readonly seoDeliverables: PinterestPodDeliverables;
}

export interface ProduceOutput {
  readonly ok: boolean;
  readonly status: JobStatus;
  readonly jobId?: string;
  readonly job_id?: string;
  readonly logs?: readonly string[];
}

/** Full response structure when polling /api/pinterest-pod/jobs/:jobId */
export interface PodJobStatusResponse {
  readonly ok: boolean;
  readonly jobId: string;
  readonly job_id?: string;
  readonly status: PodJobStatus;
  readonly total_candidates?: number;
  readonly stepper?: PodJobStepper;
  readonly logs?: readonly string[];
  readonly candidates?: readonly PodCandidate[];
  readonly rejected_candidates?: readonly PodCandidate[];
  readonly rejectedCandidates?: readonly PodCandidate[];
  readonly clusters?: readonly ThemeCluster[];
  readonly selected_candidates?: readonly string[];
  readonly summaryMetrics?: PodSummaryMetrics;
  readonly summary_metrics?: PodSummaryMetrics;
  readonly deliverables?: DeliverablesData & PodBackendDeliverables;
  readonly reportUrl?: string;
  readonly report_url?: string;
  readonly rugShape?: string;
  readonly rugShapeDecision?: Record<string, unknown>;
  readonly niche?: string;
  readonly product?: PinterestProductType;
  readonly roomTemplates?: readonly ReferenceImage[];
  readonly room_templates?: readonly ReferenceImage[];
  readonly referenceImages?: readonly ReferenceImage[];
  readonly reference_images?: readonly ReferenceImage[];
  readonly error?: string;
  readonly message?: string;
}
export type JobDetailResponse = PodJobStatusResponse;

/** Response structure when cancelling a POD job */
export interface PodCancelJobResponse {
  readonly ok: boolean;
  readonly jobId?: string;
  readonly status?: string;
  readonly message?: string;
}
export type CancelJobOutput = PodCancelJobResponse;

/** Polling control options */
export interface PodPollOptions {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly onProgress?: (status: PodJobStatusResponse) => void;
  readonly signal?: AbortSignal;
  readonly baseUrl?: string;
}

/** Print master specifications conforming to factory print standards */
export interface PodPrintMasterSpec {
  readonly cmykUrl: string;
  readonly rgbUrl: string;
  readonly localFilePath?: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpi: 300;
  readonly colorMode?: "CMYK" | "RGB";
  readonly label?: string;
  readonly badge?: string;
}

/** Product cutout specifications (transparent background & pure white #ffffff background) */
export interface PodCutoutSpec {
  readonly transparentUrl: string;
  readonly whiteBgUrl: string;
  readonly localFilePath?: string;
}

/** AI-composed room lifestyle mockup */
export interface PodComposedMockupSpec {
  readonly referenceImageId: string;
  readonly mockupUrl: string;
  readonly localFilePath?: string;
  readonly detectedSceneType: string;
  readonly detectedSceneDescription: string;
}

/** Single item in the SEO handoff deliverables package */
export interface PodDeliverableItem {
  readonly designId: string;
  readonly sourceCandidateId: string;
  readonly productType: PodProductType;
  readonly originalPinTitle: string;
  readonly trendKeywords: readonly string[];
  readonly printMaster: PodPrintMasterSpec;
  readonly cutoutProduct: PodCutoutSpec;
  readonly composedMockups: readonly PodComposedMockupSpec[];
}

/** Complete deliverables contract handed off to the SEO & Content module */
export interface PinterestPodDeliverables {
  readonly workflowId: string;
  readonly success: true;
  readonly productType: PodProductType;
  readonly totalProduced: number;
  readonly items: readonly PodDeliverableItem[];
}

/** Recent job or run item for UI history listing */
export interface PodRecentRunItem {
  readonly type: "cached_job" | "standalone_run";
  readonly id: string;
  readonly jobId: string;
  readonly job_id?: string;
  readonly status: PodJobStatus;
  readonly createdAt?: number;
  readonly title?: string;
  readonly niche?: string;
  readonly product?: string;
  readonly productType?: string;
  readonly candidateCount?: number;
  readonly deliverableCount?: number;
  readonly cmykCount?: number;
  readonly mockupCount?: number;
  readonly thumbnails?: readonly string[];
  readonly hasManifest?: boolean;
}

/** General server status and recent runs response */
export interface PodStatusResponse {
  readonly ok: boolean;
  readonly service?: {
    readonly online: boolean;
    readonly error?: string;
    readonly port?: number;
  };
  readonly recent?: readonly PodRecentRunItem[];
  readonly presets?: Record<string, unknown>;
}

/** Response from handing over deliverables to the SEO Module */
export interface SeoHandoverResponse {
  readonly success: boolean;
  readonly message: string;
  readonly receivedAt?: number;
  readonly printMasterCount?: number;
  readonly approvedMockupCount?: number;
  readonly savedPath?: string;
}

/** Pinterest Pod client interface for UI consumption */
export interface PinterestPodClient {
  getAuthStatus(): Promise<PinterestAuthStatus>;
  launchLogin(timeout?: number): Promise<PinterestLaunchLoginOutput>;
  saveOAuthToken?(payload: SavePinterestTokenPayload): Promise<SavePinterestTokenResponse>;
  getOAuthAuthorizeUrl?(redirectUri?: string): Promise<{ readonly ok: boolean; readonly auth_url: string }>;
  discoverTrends(input: TrendDiscoveryInput): Promise<TrendDiscoveryResult>;
  createJob(input: CreateJobInput): Promise<CreateJobOutput>;
  getJobDetail(jobId: string): Promise<JobDetailResponse>;
  rescueCandidate(jobId: string, candidateId: string): Promise<{ readonly ok: boolean; readonly candidate: PodCandidate }>;
  produce(input: ProduceInput): Promise<ProduceOutput>;
  cancelJob(jobId: string): Promise<CancelJobOutput>;
  getStatus(): Promise<PodStatusResponse>;
  deleteJob(jobId: string): Promise<{ readonly ok: boolean; readonly message?: string }>;
  handoverToSeo?(payload: PinterestPodDeliverables): Promise<SeoHandoverResponse>;
}

/** Factory specification definition for print production */
export interface PodFactoryPrintStandard {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpi: 300;
  readonly colorMode: "CMYK";
  readonly aspectRatio: string;
  readonly label: string;
  readonly badge: string;
}

/** Storefront specification definition for e-commerce display */
export interface PodStorefrontStandard {
  readonly width: number;
  readonly height: number;
  readonly fit: "contain";
  readonly background: "#ffffff";
  readonly upscale: boolean;
  readonly label: string;
  readonly badge: string;
}

/** Standard factory specifications lookup by product type */
export const FACTORY_PRINT_STANDARDS: Readonly<Record<PodProductType, PodFactoryPrintStandard>> = {
  bag: {
    widthPx: 4500,
    heightPx: 5400,
    dpi: 300,
    colorMode: "CMYK",
    aspectRatio: "5:6",
    label: "4500 x 5400 px @ 300 DPI (CMYK)",
    badge: "✓ Chuẩn in xưởng: 4500 x 5400 px @ 300 DPI (CMYK)",
  },
  rug: {
    widthPx: 4000,
    heightPx: 6400,
    dpi: 300,
    colorMode: "CMYK",
    aspectRatio: "5:8",
    label: "4000 x 6400 px @ 300 DPI (CMYK)",
    badge: "✓ Chuẩn in xưởng: 4000 x 6400 px @ 300 DPI (CMYK)",
  },
  blanket: {
    widthPx: 10000,
    heightPx: 11000,
    dpi: 300,
    colorMode: "CMYK",
    aspectRatio: "10:11",
    label: "10000 x 11000 px @ 300 DPI (CMYK)",
    badge: "✓ Chuẩn in xưởng: 10000 x 11000 px @ 300 DPI (CMYK)",
  },
  custom: {
    widthPx: 4000,
    heightPx: 6400,
    dpi: 300,
    colorMode: "CMYK",
    aspectRatio: "5:8",
    label: "4000 x 6400 px @ 300 DPI (CMYK)",
    badge: "✓ Chuẩn in xưởng: 4000 x 6400 px @ 300 DPI (CMYK)",
  },
};

/** Standard storefront image display specification */
export const STOREFRONT_DISPLAY_STANDARD: Readonly<PodStorefrontStandard> = {
  width: 1500,
  height: 1500,
  fit: "contain",
  background: "#ffffff",
  upscale: true,
  label: "1500 x 1500 px (White Background #ffffff, Fit Contain)",
  badge: "Shopify Storefront: 1500 x 1500 px (Fit Contain, #ffffff)",
};

/** Product size & pricing variant preset specification */
export interface PodSizePresetItem {
  readonly label: string;
  readonly code: string;
  readonly price: string;
  readonly compareAtPrice: string;
}

/** Standard size and pricing presets for Rug and Blanket products */
export const POD_SIZE_PRESETS: Readonly<
  Record<"rug_rectangle" | "rug_round" | "blanket", readonly PodSizePresetItem[]>
> = {
  rug_rectangle: [
    { label: '36" x 60"', code: "36X60", price: "69.99", compareAtPrice: "89.99" },
    { label: '48" x 72"', code: "48X72", price: "99.99", compareAtPrice: "129.99" },
    { label: '60" x 96"', code: "60X96", price: "149.99", compareAtPrice: "189.99" },
  ],
  rug_round: [
    { label: '3 ft Round (36")', code: "3RND", price: "59.99", compareAtPrice: "79.99" },
    { label: '4 ft Round (48")', code: "4RND", price: "89.99", compareAtPrice: "119.99" },
  ],
  blanket: [
    { label: '50" x 60"', code: "50X60", price: "49.99", compareAtPrice: "69.99" },
    { label: '60" x 80"', code: "60X80", price: "69.99", compareAtPrice: "89.99" },
  ],
};
