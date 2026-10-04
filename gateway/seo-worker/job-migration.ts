import { createHash } from "node:crypto";

import { resolveStoreProfile } from "../../src/modules/seo-content";
import { assertV2WorkerJob, parseSeoGenerationInput } from "../custom-gpt-seo/input-contract";
import { canonicalizeJson } from "../canonical-json";
import { SeoWorkerError } from "./protocol";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import type { SeoContentImageInput } from "../../src/shared/seo-content-contract";

const MIGRATABLE_STATUSES = new Set(["PENDING", "WAITING_INPUT", "NEEDS_CHANGES"]);

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function legacyImages(value: unknown): readonly SeoContentImageInput[] {
  if (!Array.isArray(value)) throw new SeoWorkerError("JOB_MIGRATION_IMAGES_REQUIRED");
  const images = value.map((candidate) => {
    const image = record(candidate);
    const id = optionalString(image.id);
    const url = optionalString(image.url);
    if (!id || !url) throw new SeoWorkerError("JOB_MIGRATION_IMAGES_REQUIRED");
    const contentFingerprint = optionalString(image.contentFingerprint);
    return { id, url, ...(contentFingerprint ? { contentFingerprint } : {}) };
  });
  if (!images.length) throw new SeoWorkerError("JOB_MIGRATION_IMAGES_REQUIRED");
  return images;
}

export function migrateLegacyWorkerJob(job: GptSeoJob): { readonly job: GptSeoJob; readonly migrated: boolean } {
  try {
    assertV2WorkerJob(job);
    return { job, migrated: false };
  } catch {
    // Only pre-run jobs may be rehydrated. Active leases/finalizers must settle under V1 fencing.
  }
  if (["IN_PROGRESS", "VALIDATING"].includes(job.status)) throw new SeoWorkerError("LEGACY_JOB_NOT_DRAINED");
  if (!MIGRATABLE_STATUSES.has(job.status)) throw new SeoWorkerError("JOB_MIGRATION_STATE_UNSUPPORTED");

  const legacyInput = record(job.input);
  const original = record(job.original);
  const profile = resolveStoreProfile({
    storeId: job.storeId,
    siteDomain: optionalString(original.shopDomain) ?? optionalString(original.siteDomain),
  });
  if (!profile || profile.storeId !== job.storeId) throw new SeoWorkerError("JOB_MIGRATION_PROFILE_REQUIRED");
  const niche = optionalString(legacyInput.niche);
  if (!niche) throw new SeoWorkerError("JOB_MIGRATION_NICHE_REQUIRED");
  const productId = optionalString(legacyInput.productId)
    ?? (job.source === "auto_seo" ? optionalString(job.sourceIdentity) : undefined);
  if (!optionalString(job.sourceIdentity)) throw new SeoWorkerError("JOB_MIGRATION_SOURCE_INVALID");

  const input = parseSeoGenerationInput({ images: legacyImages(legacyInput.images), niche, storeProfile: profile });
  const sourceIdentity = job.source === "auto_seo" ? job.sourceIdentity.replace(/^gid:\/\/shopify\/Product\//, "") : job.sourceIdentity;
  const execution = {
    storeId: job.storeId,
    ...(productId ? { productId: productId.replace(/^gid:\/\/shopify\/Product\//, "") } : {}),
    source: job.source,
    sourceIdentity,
    ...(job.sourceRevision ? { sourceRevision: job.sourceRevision } : {}),
    ...(optionalString(original.updatedAt) ? { shopifyUpdatedAt: optionalString(original.updatedAt) } : {}),
    providerId: job.settings.provider,
    pipelineVersion: `seo-content-input-v2:${profile.profileVersion}`,
    originalSnapshot: job.original,
  } as const;
  return {
    migrated: true,
    job: {
      ...job,
      input,
      execution,
      sourceIdentity,
      inputHash: createHash("sha256").update(canonicalizeJson(input)).digest("hex"),
      status: "PENDING",
      checkpoints: {},
      error: undefined,
      result: undefined,
      finalizeAttempts: 0,
      nextAttemptAt: undefined,
      finalizerToken: undefined,
      finalizerUntil: undefined,
    },
  };
}

/** Validates whether a failed V1 job has enough immutable source to explain/retry migration without mutating its history. */
export function validateFailedLegacyWorkerJob(job: GptSeoJob): void {
  try {
    assertV2WorkerJob(job);
    return;
  } catch {
    migrateLegacyWorkerJob({ ...job, status: "PENDING" });
  }
}
