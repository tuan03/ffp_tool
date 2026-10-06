import type {
  SeoContentGenerationInput,
  SeoExecutionEnvelope,
} from "../../shared/seo-content-contract";

export type SeoProvider = "gemini" | "custom_gpt" | "codex_mcp";
export interface WorkerMetrics {
  readonly generatedAt: number; readonly start: number; readonly end: number; readonly eventCoverageSince: number;
  readonly hours: number; readonly bucketHours: number;
  readonly states: Readonly<Record<string, number>>;
  readonly queueDepth: number; readonly successfulJobs: number; readonly jobsPerHour: number;
  readonly attemptsStarted: number; readonly attemptsEnded: number; readonly retriedAttempts: number; readonly failedAttempts: number;
  readonly retryRate: number | null; readonly failureRate: number | null; readonly averageProcessingMs: number | null;
  readonly leaseExpirations: number; readonly quotaFailures: number; readonly tokenExpirations: number;
  readonly expiredTokenRequests: number;
  readonly duplicateSubmissionsPrevented: number; readonly staleLeaseRejections: number; readonly staleSourceRejections: number;
  readonly series: readonly { readonly start: number; readonly completed: number }[];
}
export interface WorkerReviewHistory {
  readonly total: number;
  readonly nextOffset: number | null;
  readonly entries: readonly {
    readonly jobId: string;
    readonly previousJobId: string | null;
    readonly status: string;
    readonly workerId: string | null;
    readonly runId: string | null;
    readonly attemptCount: number;
    readonly sourceVersion: string | null;
    readonly rulesVersion: number | null;
    readonly checkpoints: readonly string[];
    readonly imageReceipts: number;
    readonly errorCode: string | null;
    readonly publishState: string | null;
    readonly seoVersion: number | null;
    readonly createdAt: number;
  }[];
}
export interface SeoPublishReceipt {
  readonly id: string;
  readonly jobId: string;
  readonly state: string;
  readonly errorCode: string | null;
  readonly seoVersion: number | null;
}
export interface ProductSeoVersionDto {
  readonly id: string;
  readonly storeId: string;
  readonly productId: string;
  readonly versionNumber: number;
  readonly snapshotId: string;
  readonly beforeSnapshotId: string | null;
  readonly predecessorVersionId: string | null;
  readonly source: "BASELINE" | "AUTO_SEO" | "ROLLBACK" | "IMPORTED";
  readonly publishOperationId: string | null;
  readonly restoredFromVersionId: string | null;
  readonly appliedAt: number;
  readonly publicEffectiveAt: number | null;
}
export interface SeoVersionCapability {
  readonly enabled: boolean;
  readonly reasonCode: string | null;
}
export interface SeoProductLifecycleDto {
  readonly flags: { readonly storeId: string; readonly readEnabled: boolean; readonly writeEnabled: boolean };
  readonly current: null | {
    readonly storeId: string; readonly shopifyProductGid: string; readonly currentVersion: ProductSeoVersionDto;
    readonly currentSnapshotId: string; readonly currentContentHash: string; readonly state: "ACTIVE" | "DIRTY" | "ARCHIVED" | "DELETED";
    readonly shopifyStatus: string; readonly currentUrl: string | null; readonly lastSeenAt: number; readonly hasExternalChanges: boolean;
  };
  readonly capabilities: Readonly<Record<"baselineRefresh" | "rollbackDraft" | "publish" | "reconcile", SeoVersionCapability>>;
}
export interface SeoVersionPageDto {
  readonly entries: readonly ProductSeoVersionDto[];
  readonly total: number;
  readonly nextOffset: number | null;
}
export type SeoVersionDiffValueDto = { readonly presence: "MISSING" } | { readonly presence: "VALUE"; readonly value: string | number | null };
export interface SeoVersionDiffDto {
  readonly fromVersion: ProductSeoVersionDto;
  readonly toVersion: ProductSeoVersionDto;
  readonly fields: readonly { readonly field: string; readonly before: SeoVersionDiffValueDto; readonly after: SeoVersionDiffValueDto }[];
  readonly images: readonly { readonly mediaGid: string; readonly change: "ADDED" | "REMOVED" | "CHANGED";
    readonly fields: readonly { readonly field: string; readonly before: SeoVersionDiffValueDto; readonly after: SeoVersionDiffValueDto }[] }[];
  readonly hasChanges: boolean;
}
export interface SeoRollbackDraftRequestDto {
  readonly id: string; readonly requestId: string; readonly storeId: string; readonly shopifyProductGid: string;
  readonly basedOnVersionId: string; readonly basedOnSnapshotId: string; readonly basedOnContentHash: string;
  readonly restoredFromVersionId: string; readonly restoredFromSnapshotId: string; readonly status: "REQUESTED";
  readonly requestedBy: string; readonly createdAt: number;
}
export interface AgentAccessToken {
  readonly id: string;
  readonly storeIds?: readonly string[];
  readonly workerId: string;
  readonly createdBy: string;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly lastSeenAt: number | null;
  readonly jobId: string | null;
}
export interface AgentAccessPage {
  readonly tokens: readonly AgentAccessToken[];
  readonly total: number;
  readonly nextOffset: number | null;
  readonly claimsEnabled: boolean;
}
export interface AgentRunPage {
  readonly runs: readonly {
    readonly id: string;
    readonly workerId: string;
    readonly target: number;
    readonly successful: number;
    readonly state: string;
    readonly stopReason: string | null;
  }[];
  readonly total: number;
  readonly nextOffset: number | null;
}
export type ExternalSeoProvider = Exclude<SeoProvider, "gemini">;
export type GptJobStatus = "PENDING" | "IN_PROGRESS" | "WAITING_INPUT" | "VALIDATING" | "NEEDS_CHANGES" | "REVIEW_READY" | "FAILED" | "CANCELLED";
export type GptStage = "analysis" | "research" | "keywords" | "submission";
export type GptSeoInput = SeoContentGenerationInput;
export interface GptSeoSettings {
  readonly provider: SeoProvider;
  readonly batchSize: number;
  readonly version: number;
  readonly language: string;
  readonly instructions: string;
}
export interface GptSeoEnqueue {
  readonly performanceRecommendationId?: string;
  readonly input: GptSeoInput;
  readonly execution: SeoExecutionEnvelope;
  readonly settings?: GptSeoSettings;
}
export interface GptSeoJob extends GptSeoEnqueue {
  readonly id: string;
  /** Persisted operational columns retained for queue/query compatibility. */
  readonly storeId: string;
  readonly source: "amazon" | "auto_seo";
  readonly sourceIdentity: string;
  readonly sourceRevision?: string;
  readonly original: unknown;
  readonly inputHash: string;
  readonly settings: GptSeoSettings;
  readonly status: GptJobStatus;
  readonly cancellationReason?: "OPERATOR_QUEUE_CLEAR";
  readonly shopifySyncStatus?: "SYNCING" | "UNKNOWN" | "SYNCED" | "ROLLED_BACK" | "FAILED";
  readonly checkpoints: Partial<Record<GptStage, unknown>>;
  readonly result?: unknown;
  readonly error?: string;
  readonly finalizeAttempts?: number;
  readonly nextAttemptAt?: number;
  readonly finalizerToken?: string;
  readonly finalizerUntil?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}
export interface GptSeoBatch {
  readonly id: string;
  readonly provider: ExternalSeoProvider;
  readonly ownerId: string;
  readonly leaseToken: string;
  readonly expiresAt: number;
  readonly jobs: readonly { readonly id: string; readonly title: string; readonly status: GptJobStatus }[];
}
export interface ClearQueueResult {
  readonly cleared: number;
  readonly preservedActive: number;
  readonly preservedSynced: number;
}
export interface GptLeaseMutation {
  readonly batchId: string;
  readonly leaseToken: string;
  readonly requestId: string;
}
export interface GptCheckpointMutation extends GptLeaseMutation {
  readonly stage: GptStage;
  readonly payload: unknown;
  readonly requestPayload?: unknown;
}
