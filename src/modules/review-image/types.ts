export type ReviewImageScope = "main" | "set";
export type ReviewImageStatus = "queued" | "running" | "completed" | "failed";

export interface ReviewImageJob {
  readonly job_id: string;
  readonly status: ReviewImageStatus;
  readonly template_name: string;
  readonly scope: ReviewImageScope;
  readonly approved: boolean;
  readonly error: string | null;
  readonly output_name: string | null;
}

export interface CreateReviewImageInput {
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
  readonly fileName: string;
  readonly imageDataUrl: string;
}

export interface ReviewImageClient {
  setGatewayToken(token: string): void;
  health(): Promise<{ readonly templates: number }>;
  listTemplates(): Promise<readonly ReviewImageTemplate[]>;
  uploadTemplate(input: UploadReviewTemplateInput): Promise<ReviewImageTemplate>;
  create(input: CreateReviewImageInput): Promise<ReviewImageJob>;
  job(jobId: string): Promise<ReviewImageJob>;
  approve(jobId: string): Promise<ReviewImageJob>;
  template(name: string): Promise<Blob>;
  image(jobId: string): Promise<Blob>;
  download(jobId: string): Promise<Blob>;
}
