export type ReviewImageScope = "main" | "set" | "single";
export type ReviewImageStatus = "queued" | "running" | "completed" | "failed";

export interface ReviewImageJob {
  readonly job_id: string;
  readonly store_id: string;
  readonly status: ReviewImageStatus;
  readonly template_name: string;
  readonly scope: ReviewImageScope;
  readonly approved: boolean;
  readonly error: string | null;
  readonly output_name: string | null;
}

export interface CreateReviewImageInput {
  readonly storeId: string;
  readonly productDataUrl: string;
  readonly prompt: string;
  readonly scope: ReviewImageScope;
  readonly templateName?: string;
  readonly excludeTemplate?: string;
}

export interface ReviewImageTemplate {
  readonly name: string;
}

export interface UploadReviewTemplateInput {
  readonly storeId: string;
  readonly fileName: string;
  readonly imageDataUrl: string;
}

export interface ReviewImageDeleteFailure {
  readonly name: string;
  readonly message: string;
}

export interface DeleteReviewTemplatesResult {
  readonly deleted: readonly string[];
  readonly failures: readonly ReviewImageDeleteFailure[];
}

export interface ReviewImageShopifyFile {
  readonly fileId: string;
  readonly shopifyCdnUrl: string;
  readonly fileStatus: string;
}

export interface ReviewImageClient {
  setGatewayToken(token: string): void;
  health(): Promise<{ readonly templates: number }>;
  listTemplates(storeId: string): Promise<readonly ReviewImageTemplate[]>;
  uploadTemplate(input: UploadReviewTemplateInput): Promise<ReviewImageTemplate>;
  deleteTemplates(storeId: string, names: readonly string[]): Promise<DeleteReviewTemplatesResult>;
  create(input: CreateReviewImageInput): Promise<ReviewImageJob>;
  job(jobId: string): Promise<ReviewImageJob>;
  approve(jobId: string): Promise<ReviewImageJob>;
  template(storeId: string, name: string): Promise<Blob>;
  image(jobId: string): Promise<Blob>;
  download(jobId: string): Promise<Blob>;
  uploadToShopify(jobId: string, storeId: string): Promise<ReviewImageShopifyFile>;
}
