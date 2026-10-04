import type { GptSeoJob, GptSeoSettings } from "../types";
import type { SeoStoreProfile } from "../../../shared/seo-content-contract";

export const mockSettings: GptSeoSettings = { provider: "custom_gpt", batchSize: 5, version: 1, language: "en-US", instructions: "Use verified facts only." };

const MOCK_STORE_PROFILE: SeoStoreProfile = {
  profileId: "capozen-default",
  profileVersion: "2.0.0",
  storeId: "capozen",
  storeName: "Capozen",
  locale: "en-US",
  language: "English",
  niche: "rugs",
  brandVoice: ["clear"],
  contentRules: ["Use only image-grounded product facts."],
  prohibitedClaims: ["Do not invent hidden materials or construction."],
  seoConstraints: {
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  },
};

const execution = {
  storeId: "capozen",
  productId: "1",
  source: "auto_seo" as const,
  sourceIdentity: "1",
  providerId: "custom_gpt",
  pipelineVersion: "seo-content-input-v2",
  originalSnapshot: {},
};

export const mockJobs: readonly GptSeoJob[] = [{
  id: "mock-gpt-1",
  storeId: execution.storeId,
  source: execution.source,
  sourceIdentity: execution.sourceIdentity,
  inputHash: "mock",
  settings: mockSettings,
  input: {
    niche: "rugs",
    storeProfile: MOCK_STORE_PROFILE,
    images: [{ id: "mock-image-1", url: "https://cdn.example.com/rug.jpg" }],
  },
  execution,
  original: execution.originalSnapshot,
  status: "PENDING",
  checkpoints: {},
  createdAt: 0,
  updatedAt: 0,
}];
