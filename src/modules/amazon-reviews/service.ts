import type { AmazonReview, AmazonReviewJob, ReviewClient } from "./types";

interface ServiceOptions {
  readonly coordinatorUrl: string;
  readonly fetchImplementation?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.detail === "string" ? body.detail :
      isRecord(body) && typeof body.error === "string" ? body.error : "Amazon Reviews request failed.";
    throw new Error(message);
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
      const response = await send("/api/amazon-reviews/samples", input);
      if (!isRecord(response) || !Array.isArray(response.samples) || typeof response.rejected !== "number" || !Array.isArray(response.warnings)) {
        throw new Error("Gateway returned invalid AI review samples.");
      }
      return response as { samples: AmazonReview[]; rejected: number; warnings: string[] };
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
