import type { AmazonReview, AmazonReviewJob, ReviewClient, ReviewGenerationJob } from "../types";

const MOCK_JOB_ID = "mock-amazon-reviews";

function mockJob(): AmazonReviewJob {
  return {
    jobId: MOCK_JOB_ID, status: "completed", asin: "B012345678", sourceUrl: "https://www.amazon.com/dp/B012345678",
    progress: { phase: "context", message: "Đã lấy ngữ cảnh sản phẩm.", completed: 1, total: 1 },
    reviewData: { context: { asin: "B012345678", url: "https://www.amazon.com/dp/B012345678", title: "Autumn Deer Rug", description: "Printed deer design with autumn colors." }, reviews: [], reviewCount: 0, pagesFetched: 0, stopReason: "context_ready", warnings: [] },
    samples: [],
  };
}

export function createMockReviewClient(): ReviewClient {
  let currentJob: AmazonReviewJob | null = mockJob();
  let generation: ReviewGenerationJob | null = null;
  const requests = new Map<string, ReviewGenerationJob>();
  return {
    create: async () => { currentJob = mockJob(); generation = null; requests.clear(); return { jobId: MOCK_JOB_ID }; },
    get: async (jobId) => {
      if (!currentJob || currentJob.jobId !== jobId) throw new Error("Review job was not found.");
      return structuredClone(currentJob);
    },
    clear: async (jobId) => { if (currentJob?.jobId === jobId) currentJob = null; },
    generate: async (input) => {
      const previous = requests.get(input.requestId);
      if (previous) {
        if (previous.contextJobId !== input.contextJobId || previous.storeId !== input.storeId || previous.count !== input.count) throw new Error("REVIEW_REQUEST_CONFLICT");
        return structuredClone(previous);
      }
      if (!currentJob || currentJob.jobId !== input.contextJobId) throw new Error("Review job was not found.");
      const startIndex = currentJob.samples.length + 1;
      const samples = Array.from({ length: input.count }, (_, index): AmazonReview => ({
        reviewId: `SYNTH-${currentJob?.asin}-${String(startIndex + index).padStart(3, "0")}`,
        author: `Taylor ${String.fromCharCode(65 + index)}.`, rating: 5 - ((startIndex - 1 + index) % 3),
        body: index % 2 ? "The autumn colors look balanced across the print." : "The deer artwork reads clearly on the rug.",
        variantText: "", verifiedPurchase: false, synthetic: true, source: "ai_sample", promptVersion: "review_sample_v3", qualityStatus: "accepted", qualityWarnings: [],
      }));
      currentJob = { ...currentJob, samples: [...currentJob.samples, ...samples] };
      generation = { id: input.requestId, contextJobId: input.contextJobId, storeId: input.storeId, count: input.count,
        status: "completed", createdAt: "2026-01-01T00:00:00.000Z", accepted: samples.length, rejected: 0, warnings: [] };
      requests.set(input.requestId, structuredClone(generation));
      return structuredClone(generation);
    },
    latestGeneration: async (contextJobId, storeId) => generation?.contextJobId === contextJobId && generation.storeId === storeId ? structuredClone(generation) : null,
    cancelGeneration: async () => { if (!generation) throw new Error("Review generation not found"); generation = { ...generation, status: "cancelled" }; return structuredClone(generation); },
    retryGenerationSave: async () => { if (!generation) throw new Error("Review generation not found"); return structuredClone(generation); },
    saveSamples: async (jobId, samples) => {
      if (!currentJob || currentJob.jobId !== jobId) throw new Error("Review job was not found.");
      currentJob = { ...currentJob, samples: [...currentJob.samples, ...structuredClone(samples)] };
    },
    export: async () => { throw new Error("Chế độ mock không tạo file XLSX; hãy dùng backend để xuất file."); },
  };
}
