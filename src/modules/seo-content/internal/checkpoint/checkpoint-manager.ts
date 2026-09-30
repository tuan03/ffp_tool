import type { SeoContentInput } from "../../types";
import type { SeoStageName } from "../domain-types";
import { computeProductInputHash, computeStageHash } from "./checkpoint-hasher";
import { FileSeoCheckpointStore } from "./checkpoint-store";
import {
  RecordStageFailureParams,
  RecordStageSuccessParams,
  SEO_CHECKPOINT_TTL_MS,
  SeoCheckpoint,
  SeoCheckpointManagerOptions,
  SeoCheckpointStore,
  SeoStageCheckpoint,
  SeoStageErrorDetails,
  SeoStageRetryLog,
} from "./types";

export const DEFAULT_STAGE_MODELS: Readonly<Record<SeoStageName, string>> = Object.freeze({
  b1: "gemini-2.5-flash",
  b2: "gemini-2.5-flash",
  b3: "google-suggest",
  b4: "text-embedding-004",
  b5: "gemini-2.5-flash",
  b6: "sharp-webp",
});

export const DEFAULT_STAGE_PROMPT_VERSIONS: Readonly<Record<SeoStageName, string>> = Object.freeze({
  b1: "1.0.0",
  b2: "1.0.0",
  b3: "1.0.0",
  b4: "1.0.0",
  b5: "1.0.0",
  b6: "1.0.0",
});

/**
 * Manages SEO stage checkpoints, cache freshness evaluation,
 * 7-day retention enforcement, retry logs, and selective invalidation.
 */
export class SeoCheckpointManager {
  private readonly store: SeoCheckpointStore;
  private readonly ttlMs: number;
  private readonly defaultPromptVersions: Readonly<Record<SeoStageName, string>>;
  private readonly defaultModels: Readonly<Record<SeoStageName, string>>;

  constructor(options: SeoCheckpointManagerOptions = {}) {
    this.store = options.store ?? new FileSeoCheckpointStore();
    this.ttlMs = options.ttlMs ?? SEO_CHECKPOINT_TTL_MS;
    this.defaultPromptVersions = Object.freeze({
      ...DEFAULT_STAGE_PROMPT_VERSIONS,
      ...options.defaultPromptVersions,
    });
    this.defaultModels = Object.freeze({
      ...DEFAULT_STAGE_MODELS,
      ...options.defaultModels,
    });
  }

  public getStore(): SeoCheckpointStore {
    return this.store;
  }

  public getTtlMs(): number {
    return this.ttlMs;
  }

  public getDefaultPromptVersion(stage: string): string {
    const key = stage.toLowerCase() as SeoStageName;
    return this.defaultPromptVersions[key] ?? "1.0.0";
  }

  public getDefaultModel(stage: string): string {
    const key = stage.toLowerCase() as SeoStageName;
    return this.defaultModels[key] ?? "default-model";
  }

  public computeProductInputHash(input: SeoContentInput): string {
    return computeProductInputHash(input);
  }

  public computeStageHash(
    stage: string,
    inputHash: string,
    upstreamHash: string,
    promptVersion?: string,
    model?: string,
    extraConfig?: Readonly<Record<string, unknown>>,
  ): string {
    const effectivePromptVersion = promptVersion ?? this.getDefaultPromptVersion(stage);
    const effectiveModel = model ?? this.getDefaultModel(stage);
    return computeStageHash(stage, inputHash, upstreamHash, effectivePromptVersion, effectiveModel, extraConfig);
  }

  public async loadCheckpoint(inputHash: string, now: number = Date.now()): Promise<SeoCheckpoint | null> {
    const checkpoint = await this.store.get(inputHash);
    if (!checkpoint) return null;

    if (typeof checkpoint.expiresAt === "number" && checkpoint.expiresAt <= now) {
      await this.store.delete(inputHash).catch(() => {});
      return null;
    }

    return checkpoint;
  }

  public isStageFresh(
    stageCheckpoint: SeoStageCheckpoint | undefined,
    expectedStageHash: string,
  ): boolean {
    if (!stageCheckpoint) return false;
    if (stageCheckpoint.status !== "completed") return false;
    return stageCheckpoint.stageHash === expectedStageHash;
  }

  public async recordStageSuccess(
    input: SeoContentInput,
    stage: string,
    params: RecordStageSuccessParams,
  ): Promise<SeoCheckpoint> {
    const inputHash = computeProductInputHash(input);
    const existing = await this.store.get(inputHash);
    const now = Date.now();

    const stageCheckpoint: SeoStageCheckpoint = {
      stage,
      status: "completed",
      stageHash: params.stageHash,
      upstreamHash: params.upstreamHash,
      promptVersion: params.promptVersion ?? this.getDefaultPromptVersion(stage),
      model: params.model ?? this.getDefaultModel(stage),
      data: params.data,
      contextUpdates: params.contextUpdates,
      fallbacks: params.fallbacks ? [...params.fallbacks] : [],
      warnings: params.warnings ? [...params.warnings] : [],
      durationMs: params.durationMs,
      retryLogs: params.retryLogs ? [...params.retryLogs] : (existing?.stages[stage]?.retryLogs ?? []),
      createdAt: existing?.stages[stage]?.createdAt ?? now,
      updatedAt: now,
    };

    const createdAt = existing?.createdAt ?? now;
    const updatedCheckpoint: SeoCheckpoint = {
      schemaVersion: 1,
      inputHash,
      storeId: input.storeId,
      productId: input.productId,
      handle: input.handle,
      sourceVersion: input.sourceVersion,
      shopifyUpdatedAt: input.shopifyUpdatedAt,
      providerId: input.providerId,
      pipelineVersion: input.pipelineVersion,
      createdAt,
      updatedAt: now,
      expiresAt: createdAt + this.ttlMs,
      stages: {
        ...existing?.stages,
        [stage]: stageCheckpoint,
      },
    };

    await this.store.set(updatedCheckpoint);
    return updatedCheckpoint;
  }

  public async recordStageFailure(
    input: SeoContentInput,
    stage: string,
    params: RecordStageFailureParams,
  ): Promise<SeoCheckpoint> {
    const inputHash = computeProductInputHash(input);
    const existing = await this.store.get(inputHash);
    const now = Date.now();

    const err = params.error;
    const errorDetails: SeoStageErrorDetails = {
      name: err instanceof Error ? err.name : "StageError",
      message: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string })?.code,
      stack: err instanceof Error ? err.stack : undefined,
    };

    const existingStage = existing?.stages[stage];
    const retryLogs = params.retryLogs
      ? [...params.retryLogs]
      : (existingStage?.retryLogs ? [...existingStage.retryLogs] : []);

    const stageCheckpoint: SeoStageCheckpoint = {
      stage,
      status: "failed",
      stageHash: params.stageHash,
      upstreamHash: params.upstreamHash,
      promptVersion: params.promptVersion ?? this.getDefaultPromptVersion(stage),
      model: params.model ?? this.getDefaultModel(stage),
      durationMs: params.durationMs,
      error: errorDetails,
      retryLogs,
      fallbacks: [],
      warnings: [],
      createdAt: existingStage?.createdAt ?? now,
      updatedAt: now,
    };

    const createdAt = existing?.createdAt ?? now;
    const updatedCheckpoint: SeoCheckpoint = {
      schemaVersion: 1,
      inputHash,
      storeId: input.storeId,
      productId: input.productId,
      handle: input.handle,
      sourceVersion: input.sourceVersion,
      shopifyUpdatedAt: input.shopifyUpdatedAt,
      providerId: input.providerId,
      pipelineVersion: input.pipelineVersion,
      createdAt,
      updatedAt: now,
      expiresAt: createdAt + this.ttlMs,
      stages: {
        ...existing?.stages,
        [stage]: stageCheckpoint,
      },
    };

    await this.store.set(updatedCheckpoint);
    return updatedCheckpoint;
  }

  public async recordStageRetry(
    input: SeoContentInput,
    stage: string,
    retryLog: SeoStageRetryLog,
  ): Promise<void> {
    const inputHash = computeProductInputHash(input);
    const existing = await this.store.get(inputHash);
    if (!existing) return;

    const existingStage = existing.stages[stage];
    const updatedRetryLogs = [...(existingStage?.retryLogs ?? []), retryLog];

    const now = Date.now();
    const updatedCheckpoint: SeoCheckpoint = {
      ...existing,
      updatedAt: now,
      stages: {
        ...existing.stages,
        [stage]: {
          ...(existingStage ?? {
            stage,
            status: "running" as const,
            stageHash: "",
            fallbacks: [],
            warnings: [],
            durationMs: 0,
            retryLogs: [],
            createdAt: now,
            updatedAt: now,
          }),
          retryLogs: updatedRetryLogs,
          updatedAt: now,
        },
      },
    };

    await this.store.set(updatedCheckpoint);
  }

  public async pruneExpired(now: number = Date.now()): Promise<number> {
    return this.store.pruneExpired(now);
  }
}
