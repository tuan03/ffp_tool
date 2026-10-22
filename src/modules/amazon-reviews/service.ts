import { z } from "zod";

import type { AmazonReviewJob, ReviewClient, ReviewGenerationJob } from "./types";

const generationSchema = z.object({ id: z.string(), contextJobId: z.string(), storeId: z.string(), count: z.number(),
  status: z.enum(["queued", "running", "validating", "saving", "save_failed", "completed", "partial", "failed", "cancelled", "interrupted"]),
  phase: z.enum(["waiting_response", "reading_response", "sending_response"]).optional(),
  createdAt: z.string(), accepted: z.number(), rejected: z.number(), warnings: z.array(z.string()), error: z.string().optional() });
function readGeneration(value: unknown): ReviewGenerationJob {
  return z.object({ job: generationSchema }).parse(value).job;
}

export function reviewGenerationErrorMessage(error: unknown): string {
  const messages: Readonly<Record<string, string>> = {
    REVIEW_EXTENSION_OFFLINE: "Chưa kết nối ChatGPT Bridge. Bật extension và ghim tab ChatGPT đã đăng nhập.",
    REVIEW_EXTENSION_UPDATE_REQUIRED: "Cần cập nhật ChatGPT Bridge lên 1.5.0 hoặc mới hơn, rồi reload extension và tab ChatGPT.",
    REVIEW_CONTEXT_UNAVAILABLE: "Ngữ cảnh không còn hoặc server chưa đọc được. Kiểm tra kết nối và lấy lại ngữ cảnh nếu cần.",
    REVIEW_REQUEST_CONFLICT: "Ngữ cảnh này đang có tác vụ khác. Chờ tác vụ hiện tại kết thúc.",
    REVIEW_SAMPLE_LIMIT: "Mỗi ngữ cảnh chỉ lưu tối đa 500 mẫu QA.",
    REVIEW_CANCEL_UNCONFIRMED: "Chưa xác nhận dừng trên ChatGPT. Kiểm tra tab đã ghim trước khi tạo lượt mới.",
  };
  return error instanceof Error && messages[error.message] ? messages[error.message] : "Chưa thực hiện được yêu cầu. Kiểm tra ChatGPT Bridge và kết nối server; không cần cào lại ngữ cảnh.";
}

interface ServiceOptions {
  readonly coordinatorUrl: string;
  readonly fetchImplementation?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ReviewRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ReviewRequestError";
    this.status = status;
  }
}

export function isMissingReviewJobError(error: unknown): boolean {
  return error instanceof ReviewRequestError && error.status === 404;
}

export function isReviewJobConflictError(error: unknown): boolean {
  return error instanceof ReviewRequestError && error.status === 409;
}

async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.detail === "string" ? body.detail :
      isRecord(body) && typeof body.error === "string" ? body.error : "Amazon Reviews request failed.";
    throw new ReviewRequestError(message, response.status);
  }
  return body;
}

function readJob(value: unknown): AmazonReviewJob {
  if (!isRecord(value) || typeof value.jobId !== "string" || typeof value.status !== "string" ||
      typeof value.asin !== "string" || !isRecord(value.reviewData) || !Array.isArray(value.samples)) {
    throw new Error("Coordinator returned an invalid review job.");
  }
  return value as unknown as AmazonReviewJob;
}

export function createReviewClient(options: ServiceOptions): ReviewClient {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const baseUrl = options.coordinatorUrl.replace(/\/$/, "");
  const send = async (url: string, value: unknown): Promise<unknown> => readResponse(await fetchImplementation(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  }));
  return {
    async create(source, maxPages = 1) {
      const response = await send(`${baseUrl}/api/v1/review-jobs`, { source, maxPages, contextOnly: true });
      if (!isRecord(response) || typeof response.id !== "string") throw new Error("Coordinator did not return a review job ID.");
      return { jobId: response.id };
    },
    async get(jobId) {
      return readJob(await readResponse(await fetchImplementation(`${baseUrl}/api/v1/review-jobs/${encodeURIComponent(jobId)}`)));
    },
    async clear(jobId) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) await readResponse(response);
    },
    async generate(input) {
      return readGeneration(await send("/api/amazon-reviews/samples", input));
    },
    async latestGeneration(contextJobId, storeId) {
      const query = new URLSearchParams({ contextJobId, storeId });
      const response = await readResponse(await fetchImplementation(`/api/amazon-reviews/samples?${query}`));
      return z.object({ job: generationSchema.nullable() }).parse(response).job;
    },
    async cancelGeneration(id) {
      return readGeneration(await send(`/api/amazon-reviews/samples/${encodeURIComponent(id)}/cancel`, {}));
    },
    async retryGenerationSave(id) {
      return readGeneration(await send(`/api/amazon-reviews/samples/${encodeURIComponent(id)}/retry-save`, {}));
    },
    async saveSamples(jobId, samples) {
      await send(`${baseUrl}/api/v1/review-jobs/${encodeURIComponent(jobId)}/samples`, { samples });
    },
    async export(jobId, input) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/review-jobs/${encodeURIComponent(jobId)}/export`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      if (!response.ok) {
        await readResponse(response);
        throw new Error("Review export failed.");
      }
      return response.blob();
    },
  };
}
