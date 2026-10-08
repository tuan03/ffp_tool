import { z } from "zod";

import { SEO_CONTENT_INPUT_CONTRACT_VERSION } from "../../src/shared/seo-content-contract";
import { canonicalizeJson } from "../canonical-json";
import { SeoWorkerError } from "../seo-worker/protocol";

import type { GptSeoEnqueue, GptSeoInput, GptSeoJob } from "../../src/modules/custom-gpt-seo";

const imageSchema = z.object({
  id: z.string().min(1).max(500),
  url: z.string().url().refine(value => ["http:", "https:"].includes(new URL(value).protocol), "Invalid image protocol"),
  contentFingerprint: z.string().min(1).max(500).optional(),
}).strict();

const offeringSchema = z.object({
  name: z.string().min(1),
  shortDescription: z.string(),
  detailedFeatures: z.string(),
}).strict();

const catalogPolicySchema = z.object({
  policyId: z.string().min(1),
  applicableNiches: z.array(z.string().min(1)),
  productIdentityTerms: z.array(z.string().min(1)),
  minimumIdentityConfidence: z.number().min(0).max(1),
  offerings: z.array(offeringSchema),
  allowedClaims: z.array(z.string()),
  requiredContentRules: z.array(z.string()),
}).strict();

const storeProfileSchema = z.object({
  profileId: z.string().min(1),
  profileVersion: z.string().min(1),
  storeId: z.string().min(1),
  storeName: z.string().min(1),
  locale: z.string().min(1),
  language: z.string().min(1),
  niche: z.string().min(1),
  brandVoice: z.array(z.string()),
  contentRules: z.array(z.string()),
  prohibitedClaims: z.array(z.string()),
  productDescriptionPolicy: z.object({
    mode: z.literal("visual-design-only"),
    excludedTopics: z.array(z.string().min(1)),
  }).strict().optional(),
  seoConstraints: z.object({
    maxTitleCharacters: z.number().int().positive(),
    maxDescriptionCharacters: z.number().int().positive(),
    maxAltCharacters: z.number().int().positive(),
  }).strict(),
  catalogPolicies: z.array(catalogPolicySchema).optional(),
}).strict();

export const seoGenerationInputSchema = z.object({
  images: z.array(imageSchema).min(1).max(100),
  niche: z.string().min(1).max(4000),
  storeProfile: storeProfileSchema,
}).strict();

const executionSchema = z.object({
  storeId: z.string().min(1).max(100),
  productId: z.string().min(1).optional(),
  source: z.enum(["amazon", "auto_seo"]),
  sourceIdentity: z.string().min(1),
  sourceRevision: z.string().min(1).optional(),
  shopifyUpdatedAt: z.string().min(1).optional(),
  providerId: z.string().min(1),
  pipelineVersion: z.string().min(1),
  originalSnapshot: z.unknown(),
}).strict();

export function parseSeoGenerationInput(value: unknown): GptSeoInput {
  return seoGenerationInputSchema.parse(value);
}

export function normalizeSeoEnqueue(value: GptSeoEnqueue): GptSeoEnqueue {
  const input = parseSeoGenerationInput(value.input);
  const execution = executionSchema.parse(value.execution);
  const productId = execution.productId?.replace(/^gid:\/\/shopify\/Product\//, "");
  const sourceIdentity = execution.source === "auto_seo"
    ? execution.sourceIdentity.replace(/^gid:\/\/shopify\/Product\//, "")
    : execution.sourceIdentity;
  if (input.storeProfile.storeId !== execution.storeId) throw new Error("Store profile does not match execution store");
  return {
    input,
    execution: { ...execution, ...(productId ? { productId } : {}), sourceIdentity },
    ...(value.performanceRecommendationId ? { performanceRecommendationId: value.performanceRecommendationId } : {}),
    ...(value.settings ? { settings: value.settings } : {}),
  };
}

export function assertV2WorkerJob(job: GptSeoJob): void {
  try {
    parseSeoGenerationInput(job.input);
    executionSchema.parse(job.execution);
    if (job.storeId !== job.execution.storeId || job.source !== job.execution.source
      || job.sourceIdentity !== job.execution.sourceIdentity
      || job.sourceRevision !== job.execution.sourceRevision
      || canonicalizeJson(job.original) !== canonicalizeJson(job.execution.originalSnapshot)) {
      throw new Error("Persisted operational envelope mismatch");
    }
  } catch (cause) {
    const error = new SeoWorkerError("INPUT_CONTRACT_UNSUPPORTED");
    Object.defineProperty(error, "cause", { value: cause, enumerable: false });
    throw error;
  }
}

export const SEO_WORKER_SCHEMA_VERSION = `ffp-seo-worker-v${SEO_CONTENT_INPUT_CONTRACT_VERSION}`;
