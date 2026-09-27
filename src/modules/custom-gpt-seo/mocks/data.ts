import type { GptSeoJob, GptSeoSettings } from "../types";

export const mockSettings: GptSeoSettings = { provider: "custom_gpt", batchSize: 5, version: 1, language: "en-US", instructions: "Use verified facts only." };
export const mockJobs: readonly GptSeoJob[] = [{ id: "mock-gpt-1", storeId: "capozen", source: "auto_seo", sourceIdentity: "mock-product", inputHash: "mock", settings: mockSettings, input: { title: "Cotton rug", description: "A cotton rug", niche: "rugs", handle: "cotton-rug", images: [] }, original: {}, status: "PENDING", checkpoints: {}, createdAt: 0, updatedAt: 0 }];
