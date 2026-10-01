import {
  checkExternalSeoKeywords,
  researchExternalSeo,
  validateExternalSeoAnalysis,
} from "../../src/modules/seo-content";
import type { ExternalSeoProvider, GptSeoJob } from "../../src/modules/custom-gpt-seo";

import { downloadProductImage } from "./images";
import type { CustomGptQueue } from "./queue";

export interface ExternalSeoWorkflowOptions {
  readonly queue: CustomGptQueue;
  readonly research?: typeof researchExternalSeo;
  readonly checkKeywords?: typeof checkExternalSeoKeywords;
  readonly downloadImage?: typeof downloadProductImage;
}

interface LeaseInput {
  readonly batchId: string;
  readonly leaseToken: string;
}

interface JobLeaseInput extends LeaseInput {
  readonly jobId: string;
}

interface MutationInput extends JobLeaseInput {
  readonly requestId: string;
}

function imageId(job: GptSeoJob, index: number): string {
  return job.input.images[index]?.id || `image-${index + 1}`;
}

function assertProvider(job: GptSeoJob, provider: ExternalSeoProvider): void {
  if (job.settings.provider !== provider) throw new Error("Job not found");
}

function assertBatchProvider(
  queue: CustomGptQueue,
  storeId: string,
  batchId: string,
  provider: ExternalSeoProvider,
): void {
  if (queue.batch(storeId, batchId).provider !== provider) throw new Error("Batch not found");
}

function publicJob(job: GptSeoJob) {
  return {
    jobId: job.id,
    source: job.source,
    sourceIdentity: job.sourceIdentity,
    sourceRevision: job.sourceRevision,
    status: job.status,
    input: {
      productId: job.input.productId,
      title: job.input.title,
      description: job.input.description,
      handle: job.input.handle,
      niche: job.input.niche,
      siteDomain: job.input.siteDomain,
      url: job.input.url,
    },
    checkpoints: job.checkpoints,
    imageIds: job.input.images.map((_, index) => imageId(job, index)),
    instructions: job.settings.instructions,
    language: job.settings.language,
  };
}

export function createExternalSeoWorkflow(options: ExternalSeoWorkflowOptions) {
  const { queue } = options;
  const getProviderJob = (storeId: string, provider: ExternalSeoProvider, jobId: string): GptSeoJob => {
    const job = queue.get(storeId, jobId);
    assertProvider(job, provider);
    return job;
  };

  return {
    getWork(storeId: string, provider: ExternalSeoProvider, ownerId: string) {
      const activeBatch = queue.activeBatch(storeId, ownerId);
      return {
        settings: queue.settings(storeId),
        counts: queue.counts(storeId, provider),
        activeBatch,
        blockedBy: null,
      };
    },

    claim(storeId: string, provider: ExternalSeoProvider, ownerId: string, requestId: string) {
      return queue.claim(storeId, requestId, provider, ownerId);
    },

    getBatch(storeId: string, provider: ExternalSeoProvider, batchId: string) {
      assertBatchProvider(queue, storeId, batchId, provider);
      return queue.batch(storeId, batchId);
    },

    getJob(storeId: string, provider: ExternalSeoProvider, jobId: string) {
      return publicJob(getProviderJob(storeId, provider, jobId));
    },

    listImageReferences(storeId: string, provider: ExternalSeoProvider, jobId: string, offset: number) {
      const job = getProviderJob(storeId, provider, jobId);
      return {
        jobId,
        images: job.input.images.slice(offset, offset + 5).map((image, localIndex) => ({
          id: imageId(job, offset + localIndex),
          url: image.url,
          alt: image.alt,
        })),
        nextOffset: offset + 5 < job.input.images.length ? offset + 5 : null,
      };
    },

    async getImage(storeId: string, provider: ExternalSeoProvider, jobId: string, requestedImageId: string) {
      const job = getProviderJob(storeId, provider, jobId);
      const index = job.input.images.findIndex((_, imageIndex) => imageId(job, imageIndex) === requestedImageId);
      if (index < 0) throw new Error("Image not found");
      return (options.downloadImage ?? downloadProductImage)(job.input.images[index]!.url);
    },

    renew(storeId: string, provider: ExternalSeoProvider, input: LeaseInput) {
      assertBatchProvider(queue, storeId, input.batchId, provider);
      return queue.renew(storeId, input.batchId, input.leaseToken);
    },

    release(storeId: string, provider: ExternalSeoProvider, input: LeaseInput) {
      assertBatchProvider(queue, storeId, input.batchId, provider);
      queue.release(storeId, input.batchId, input.leaseToken);
      return { released: true };
    },

    saveAnalysis(storeId: string, provider: ExternalSeoProvider, input: MutationInput & { readonly analysis: unknown }) {
      const job = getProviderJob(storeId, provider, input.jobId);
      validateExternalSeoAnalysis({ ...job.input, storeId }, input.analysis);
      return queue.checkpoint(storeId, input.jobId, {
        ...input,
        stage: "analysis",
        payload: input.analysis,
        requestPayload: { operation: "analysis", input },
      });
    },

    async research(storeId: string, provider: ExternalSeoProvider, input: MutationInput & { readonly seeds: readonly string[] }) {
      const job = getProviderJob(storeId, provider, input.jobId);
      queue.assertLease(storeId, input.batchId, input.leaseToken, input.jobId);
      if (!job.checkpoints.analysis) throw new Error("Save analysis first");
      if (!input.seeds.length || input.seeds.length > 5 || input.seeds.some(seed => !seed.trim() || seed.length > 120)) throw new Error("Invalid seeds");
      const requestPayload = { operation: "research", input };
      const replay = queue.replayMutation(input.jobId, input.requestId, requestPayload);
      if (replay) return replay.payload;
      const suggestions = await (options.research ?? researchExternalSeo)([...input.seeds], job.settings.language);
      const payload = { suggestions, source: "google_suggest" };
      queue.checkpoint(storeId, input.jobId, { ...input, stage: "research", payload, requestPayload });
      return payload;
    },

    async chooseKeywords(storeId: string, provider: ExternalSeoProvider, input: MutationInput & { readonly keywords: readonly string[]; readonly reason: string }) {
      const job = getProviderJob(storeId, provider, input.jobId);
      queue.assertLease(storeId, input.batchId, input.leaseToken, input.jobId);
      if (!job.checkpoints.research) throw new Error("Complete research first");
      if (!input.keywords.length || input.keywords.length > 10 || input.keywords.some(keyword => !keyword.trim() || keyword.length > 120)) throw new Error("Invalid keywords");
      if (!input.reason.trim()) throw new Error("Invalid reason");
      const requestPayload = { operation: "keywords", input };
      const replay = queue.replayMutation(input.jobId, input.requestId, requestPayload);
      if (replay) {
        const replayPayload = replay.payload && typeof replay.payload === "object" && !Array.isArray(replay.payload)
          ? replay.payload as Record<string, unknown>
          : {};
        return { saved: !Object.hasOwn(replayPayload, "saved") || replayPayload.saved === true, ...replayPayload };
      }
      const check = await (options.checkKeywords ?? checkExternalSeoKeywords)({ ...job.input, storeId }, [...input.keywords]);
      if (check.conflicts.some(conflict => conflict.matches.length)) {
        const payload = { saved: false, check };
        queue.rememberMutation(input.jobId, input.requestId, requestPayload, payload);
        return payload;
      }
      const payload = { keywords: [...input.keywords], reason: input.reason, check };
      queue.checkpoint(storeId, input.jobId, { ...input, stage: "keywords", payload, requestPayload });
      return { saved: true, ...payload };
    },

    async checkKeywordConflicts(storeId: string, provider: ExternalSeoProvider, input: JobLeaseInput & { readonly keywords: readonly string[] }) {
      const job = getProviderJob(storeId, provider, input.jobId);
      queue.assertLease(storeId, input.batchId, input.leaseToken, input.jobId);
      if (!job.checkpoints.research) throw new Error("Complete research first");
      if (!input.keywords.length || input.keywords.length > 10 || input.keywords.some(keyword => !keyword.trim() || keyword.length > 120)) throw new Error("Invalid keywords");
      return (options.checkKeywords ?? checkExternalSeoKeywords)({ ...job.input, storeId }, [...input.keywords]);
    },

    submit(storeId: string, provider: ExternalSeoProvider, input: MutationInput & { readonly submission: unknown }) {
      const job = getProviderJob(storeId, provider, input.jobId);
      if (!job.checkpoints.analysis || !job.checkpoints.research || !job.checkpoints.keywords) throw new Error("Complete analysis, research and keywords first");
      queue.checkpoint(storeId, input.jobId, {
        ...input,
        stage: "submission",
        payload: input.submission,
        requestPayload: { operation: "submission", input },
      });
      return { jobId: input.jobId, status: "VALIDATING" as const };
    },

    getResult(storeId: string, provider: ExternalSeoProvider, jobId: string) {
      const job = getProviderJob(storeId, provider, jobId);
      return { jobId, status: job.status, result: job.result, error: job.error };
    },

    reportIssue(storeId: string, provider: ExternalSeoProvider, input: JobLeaseInput & { readonly message: string }) {
      getProviderJob(storeId, provider, input.jobId);
      queue.issue(storeId, input.jobId, input.batchId, input.leaseToken, input.message);
      return { status: "WAITING_INPUT" as const };
    },

    listWaiting(storeId: string, provider: ExternalSeoProvider, offset: number) {
      const jobs = queue.list(storeId, "WAITING_INPUT", offset, provider);
      return {
        jobs: jobs.map(job => ({
          jobId: job.id,
          source: job.source,
          productId: job.input.productId,
          title: job.input.title,
          handle: job.input.handle,
          status: job.status,
          imageCount: job.input.images.length,
          issue: job.error,
        })),
        nextOffset: jobs.length === 50 ? offset + 50 : null,
      };
    },
  };
}

export type ExternalSeoWorkflow = ReturnType<typeof createExternalSeoWorkflow>;
