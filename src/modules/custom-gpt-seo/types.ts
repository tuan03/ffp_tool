export type SeoProvider = "gemini" | "custom_gpt" | "codex_mcp";
export type ExternalSeoProvider = Exclude<SeoProvider, "gemini">;
export type GptJobStatus = "PENDING" | "IN_PROGRESS" | "WAITING_INPUT" | "VALIDATING" | "NEEDS_CHANGES" | "REVIEW_READY" | "FAILED" | "CANCELLED";
export type GptStage = "analysis" | "research" | "keywords" | "submission";
export interface GptSeoInput {
  readonly title: string;
  readonly description: string;
  readonly handle: string;
  readonly niche: string;
  readonly productId?: string;
  readonly siteDomain?: string;
  readonly url?: string;
  readonly images: readonly { readonly id?: string; readonly url: string; readonly alt?: string }[];
}
export interface GptSeoSettings {
  readonly provider: SeoProvider;
  readonly batchSize: number;
  readonly version: number;
  readonly language: string;
  readonly instructions: string;
}
export interface GptSeoEnqueue {
  readonly storeId: string;
  readonly source: "amazon" | "auto_seo";
  readonly sourceIdentity: string;
  readonly sourceRevision?: string;
  readonly input: GptSeoInput;
  readonly original: unknown;
  readonly settings?: GptSeoSettings;
}
export interface GptSeoJob extends GptSeoEnqueue {
  readonly id: string;
  readonly inputHash: string;
  readonly settings: GptSeoSettings;
  readonly status: GptJobStatus;
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
