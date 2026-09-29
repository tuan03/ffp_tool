import type { AmazonReview, AmazonReviewJob, ReviewClient } from "../types";

const MOCK_JOB_ID = "mock-amazon-reviews";
const MOCK_REVIEWS: AmazonReview[] = [
  { reviewId: "R-MOCK-1", author: "Morgan L.", rating: 5, title: "Clear pattern", body: "The deer pattern is clear and the colors match the photo.", verifiedPurchase: true, synthetic: false, source: "amazon", images: [] },
  { reviewId: "R-MOCK-2", author: "Jamie R.", rating: 4, title: "Nice colors", body: "The autumn tones work well in the room.", verifiedPurchase: false, synthetic: false, source: "amazon", images: [] },
];

function mockJob(): AmazonReviewJob {
  return {
    jobId: MOCK_JOB_ID, status: "completed", asin: "B012345678", sourceUrl: "https://www.amazon.com/dp/B012345678",
    progress: { phase: "review", message: "Đã đọc 1 trang.", completed: 1, total: 1 },
    reviewData: { context: { asin: "B012345678", url: "https://www.amazon.com/dp/B012345678", title: "Autumn Deer Rug", description: "Printed deer design with autumn colors." }, reviews: structuredClone(MOCK_REVIEWS), reviewCount: 2, pagesFetched: 1, stopReason: "no_next_page", warnings: [] },
    samples: [],
  };
}

export function createMockReviewClient(): ReviewClient {
  let currentJob = mockJob();
  return {
    create: async () => ({ jobId: MOCK_JOB_ID }),
    get: async () => structuredClone(currentJob),
    generate: async (input) => ({
      samples: Array.from({ length: input.count }, (_, index): AmazonReview => ({
        reviewId: `SYNTH-${input.asin}-${String(input.startIndex + index).padStart(3, "0")}`,
        author: `Taylor ${String.fromCharCode(65 + index)}.`, rating: 5,
        body: index % 2 ? "The autumn colors look balanced across the print." : "The deer artwork reads clearly on the rug.",
        variantText: "", verifiedPurchase: false, synthetic: true, source: "ai_sample", promptVersion: "review_sample_v3", qualityStatus: "accepted", qualityWarnings: [],
      })), rejected: 0, warnings: [],
    }),
    saveSamples: async (_jobId, samples) => { currentJob = { ...currentJob, samples: [...currentJob.samples, ...structuredClone(samples)] }; },
    export: async () => { throw new Error("Chế độ mock không tạo file XLSX; hãy dùng backend để xuất file."); },
  };
}
