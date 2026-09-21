export type PinterestProductType = "rug" | "blanket" | "custom";

export type WorkflowStage = "crawl_and_review" | "produce" | "full";

export type JobStatus =
  | "idle"
  | "running"
  | "ready_for_review"
  | "producing"
  | "completed"
  | "failed"
  | "cancelled";

export interface ReferenceImage {
  readonly id: string;
  readonly url: string;
  readonly name?: string;
}

export interface CandidateItem {
  readonly id: string;
  readonly image_id?: string;
  readonly pin_id: string;
  readonly title: string;
  readonly query: string;
  readonly trend: string;
  readonly pin_url: string;
  readonly image_url: string;
  readonly image_score: number;
  readonly printability_score: number;
  readonly flat_artwork_score: number;
  readonly is_direct_printable: boolean;
  readonly recommended: boolean;
  readonly reason?: string;
}

export interface StepperState {
  readonly current_step: number;
  readonly percent: number;
  readonly current_message: string;
}

export interface SummaryMetrics {
  readonly rgb_4k_count: number;
  readonly cmyk_count: number;
  readonly lifestyle_mockup_count: number;
  readonly cutouts_count: number;
  readonly mockups_count: number;
}

export interface DeliverablePrintImage {
  readonly filename: string;
  readonly url: string;
  readonly download_url?: string;
}

export interface DeliverableLifestyleMockup {
  readonly filename: string;
  readonly url: string;
  readonly scene_type: string;
  readonly scene_description: string;
}

export interface DeliverableCutout {
  readonly filename: string;
  readonly url: string;
}

export interface ComparisonRow {
  readonly index: number;
  readonly product_label: string;
  readonly source_url: string;
  readonly cutout_url?: string;
  readonly cutout_white_url?: string;
  readonly final_print_url: string;
  readonly ai_background_urls: readonly string[];
}

export interface DeliverablesData {
  readonly print_cmyk_images: readonly DeliverablePrintImage[];
  readonly lifestyle_mockups: readonly DeliverableLifestyleMockup[];
  readonly product_cutouts_white: readonly DeliverableCutout[];
  readonly comparison_rows: readonly ComparisonRow[];
}

export interface CreateJobInput {
  readonly niche: string;
  readonly product: PinterestProductType;
  readonly workflow_stage?: WorkflowStage;
  readonly candidatePoolSize?: number;
  readonly referenceImages?: readonly ReferenceImage[];
}

export interface CreateJobOutput {
  readonly ok: boolean;
  readonly jobId: string;
  readonly job_id?: string;
  readonly status: JobStatus;
  readonly logs?: readonly string[];
}

export interface ProduceInput {
  readonly jobId: string;
  readonly selected_candidates: readonly string[];
}

export interface ProduceOutput {
  readonly ok: boolean;
  readonly status: JobStatus;
}

export interface CancelJobOutput {
  readonly ok: boolean;
  readonly status: "cancelled";
}

export interface JobDetailResponse {
  readonly ok: boolean;
  readonly jobId: string;
  readonly job_id?: string;
  readonly status: JobStatus;
  readonly total_candidates?: number;
  readonly stepper?: StepperState;
  readonly logs?: readonly string[];
  readonly candidates?: readonly CandidateItem[];
  readonly summaryMetrics?: SummaryMetrics;
  readonly summary_metrics?: SummaryMetrics;
  readonly deliverables?: DeliverablesData;
  readonly error?: string;
}

export interface PinterestAuthStatus {
  readonly ok: boolean;
  readonly logged_in: boolean;
  readonly browser_logged_in?: boolean;
  readonly status_text: string;
}

export interface PinterestLaunchLoginOutput {
  readonly ok: boolean;
  readonly message?: string;
}

/** SEO handoff payload interfaces matching docs/CONTRACT_PINTEREST_POD_TO_SEO.md */
export interface PodPrintMasterSpec {
  readonly cmykUrl: string;
  readonly rgbUrl: string;
  readonly localFilePath?: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpi: 300;
}

export interface PodCutoutSpec {
  readonly transparentUrl: string;
  readonly whiteBgUrl: string;
  readonly localFilePath?: string;
}

export interface PodComposedMockupSpec {
  readonly referenceImageId: string;
  readonly mockupUrl: string;
  readonly localFilePath?: string;
  readonly detectedSceneType: string;
  readonly detectedSceneDescription: string;
}

export interface PodDeliverableItem {
  readonly designId: string;
  readonly sourceCandidateId: string;
  readonly productType: PinterestProductType;
  readonly originalPinTitle: string;
  readonly trendKeywords: readonly string[];
  readonly printMaster: PodPrintMasterSpec;
  readonly cutoutProduct: PodCutoutSpec;
  readonly composedMockups: readonly PodComposedMockupSpec[];
}

export interface PinterestPodDeliverables {
  readonly workflowId: string;
  readonly success: true;
  readonly productType: PinterestProductType;
  readonly totalProduced: number;
  readonly items: readonly PodDeliverableItem[];
}

export interface PinterestPodClient {
  getAuthStatus(): Promise<PinterestAuthStatus>;
  launchLogin(timeout?: number): Promise<PinterestLaunchLoginOutput>;
  createJob(input: CreateJobInput): Promise<CreateJobOutput>;
  getJobDetail(jobId: string): Promise<JobDetailResponse>;
  produce(input: ProduceInput): Promise<ProduceOutput>;
  cancelJob(jobId: string): Promise<CancelJobOutput>;
}
