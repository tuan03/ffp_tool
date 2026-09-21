import type { AppEnvironment } from "../../shared/types";

/** Supported product types for Pinterest POD pipeline */
export type PodProductType = "rug" | "blanket" | "custom";

/** Workflow stage for job execution */
export type PodWorkflowStage = "crawl_and_review" | "full_pipeline";

/** Job lifecycle status */
export type PodJobStatus = "running" | "ready_for_review" | "completed" | "failed" | "cancelled";

/** Reference room image provided by Main UI for lifestyle mockup placement */
export interface PodReferenceImage {
  readonly id: string;
  readonly url: string;
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

/** Standard Pinterest Candidate crawled and scored by AI Vision */
export interface PodCandidate {
  readonly id: string;
  readonly image_id?: string;
  readonly pin_id?: string;
  readonly title: string;
  readonly query?: string;
  readonly trend?: string;
  readonly pin_url: string;
  readonly image_url: string;
  readonly image_score: number;
  readonly printability_score: number;
  readonly flat_artwork_score: number;
  readonly is_direct_printable: boolean;
  readonly recommended: boolean;
  readonly reason: string;
}

/** Stepper progress information for UI display */
export interface PodJobStepper {
  readonly current_step: number;
  readonly percent: number;
  readonly current_message: string;
}

/** Summary metrics for final deliverables showcase */
export interface PodSummaryMetrics {
  readonly rgb_4k_count: number;
  readonly cmyk_count: number;
  readonly lifestyle_mockup_count: number;
  readonly cutouts_count: number;
  readonly mockups_count: number;
}

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

/** 4-step comparison row for review and SEO alignment */
export interface PodComparisonRow {
  readonly index: number;
  readonly product_label: string;
  readonly status?: string;
  readonly reason?: string;
  readonly source_url: string;
  readonly cutout_url: string;
  readonly cutout_white_url: string;
  readonly final_print_url: string;
  readonly ai_background_urls: readonly string[];
}

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
}

/** Pinterest authentication status response */
export interface PinterestAuthStatus {
  readonly ok: boolean;
  readonly logged_in: boolean;
  readonly browser_logged_in: boolean;
  readonly status_text: string;
}

/** Payload for launching Pinterest browser login */
export interface PinterestLaunchLoginPayload {
  readonly timeout?: number;
}

/** Response from launching Pinterest browser login */
export interface PinterestLaunchLoginResponse {
  readonly ok: boolean;
  readonly status_text: string;
  readonly logged_in?: boolean;
}

/** Stage 1: Input parameters for Pinterest crawl & discovery */
export interface PinterestDiscoveryInput {
  readonly niche: string;
  readonly product: PodProductType;
  readonly workflow_stage?: PodWorkflowStage;
  readonly candidatePoolSize?: number;
  readonly referenceImages?: readonly PodReferenceImage[];
}

/** Stage 1: Output returned when candidate discovery is complete */
export interface PinterestDiscoveryOutput {
  readonly ok: boolean;
  readonly jobId: string;
  readonly status: PodJobStatus;
  readonly total_candidates: number;
  readonly stepper: PodJobStepper;
  readonly logs: readonly string[];
  readonly candidates: readonly PodCandidate[];
}

/** Stage 2: Input parameters for producing selected candidate mockups and print files */
export interface PinterestProductionInput {
  readonly jobId: string;
  readonly selected_candidates: readonly string[];
  readonly product?: PodProductType;
}

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
  readonly summaryMetrics?: PodSummaryMetrics;
  readonly summary_metrics?: PodSummaryMetrics;
  readonly deliverables?: PodBackendDeliverables;
  readonly error?: string;
  readonly message?: string;
}

/** Polling control options */
export interface PodPollOptions {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly onProgress?: (status: PodJobStatusResponse) => void;
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
