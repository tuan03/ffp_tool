import type { SeoContentInput } from "../../types";
import type { SeoPipelineContext, SeoStageName } from "../domain-types";

export type SeoStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface SeoStageRetryLog {
  readonly attempt: number;
  readonly timestamp: number;
  readonly errorCode?: string;
  readonly errorMessage: string;
  readonly isRetryable: boolean;
  readonly waitMs?: number;
}

export interface SeoStageErrorDetails {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
}

export interface SeoStageCheckpoint<T = unknown> {
  readonly stage: string;
  readonly status: SeoStageStatus;
  readonly stageHash: string;
  readonly upstreamHash?: string;
  readonly promptVersion?: string;
  readonly model?: string;
  readonly data?: T;
  readonly contextUpdates?: Partial<Omit<SeoPipelineContext, "source">>;
  readonly fallbacks: readonly string[];
  readonly warnings: readonly string[];
  readonly durationMs: number;
  readonly retryLogs: readonly SeoStageRetryLog[];
  readonly error?: SeoStageErrorDetails;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export const SEO_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (604,800,000 ms)

export interface SeoCheckpoint {
  readonly schemaVersion: 2;
  readonly inputHash: string;
  readonly storeId?: string;
  readonly productId?: string;
  readonly handle?: string;
  readonly sourceVersion?: string;
  readonly shopifyUpdatedAt?: string;
  readonly providerId?: string;
  readonly pipelineVersion?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number; // createdAt + SEO_CHECKPOINT_TTL_MS
  readonly stages: Partial<Record<string, SeoStageCheckpoint>>;
}

export interface SeoCheckpointStore {
  get(inputHash: string): Promise<SeoCheckpoint | null>;
  set(checkpoint: SeoCheckpoint): Promise<void>;
  delete(inputHash: string): Promise<void>;
  pruneExpired(now?: number): Promise<number>;
}

export interface SeoCheckpointManagerOptions {
  readonly store?: SeoCheckpointStore;
  readonly ttlMs?: number;
  readonly defaultPromptVersions?: Partial<Record<SeoStageName, string>>;
  readonly defaultModels?: Partial<Record<SeoStageName, string>>;
}

export interface RecordStageSuccessParams<T = unknown> {
  readonly stageHash: string;
  readonly upstreamHash?: string;
  readonly promptVersion?: string;
  readonly model?: string;
  readonly durationMs: number;
  readonly contextUpdates?: Partial<Omit<SeoPipelineContext, "source">>;
  readonly data?: T;
  readonly fallbacks?: readonly string[];
  readonly warnings?: readonly string[];
  readonly retryLogs?: readonly SeoStageRetryLog[];
}

export interface RecordStageFailureParams {
  readonly stageHash: string;
  readonly upstreamHash?: string;
  readonly promptVersion?: string;
  readonly model?: string;
  readonly durationMs: number;
  readonly error: unknown;
  readonly retryLogs?: readonly SeoStageRetryLog[];
}
