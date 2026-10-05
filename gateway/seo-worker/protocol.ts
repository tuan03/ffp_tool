export const WORKER_DEFAULTS = {
  leaseMs: 10 * 60_000,
  tokenMs: 24 * 60 * 60_000,
  heartbeatMs: 60_000,
  recoveryMs: 60_000,
  idleMs: 30 * 60_000,
  maxAttempts: 5,
  maxRepairs: 2,
} as const;

export class SeoWorkerError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SeoWorkerError"; }
}

export function validateTargetCount(target: number): number {
  if (!Number.isSafeInteger(target) || target < 1) throw new SeoWorkerError("INVALID_TARGET");
  return target;
}

export function getRetryDelay(attempt: number, jitter: number): number {
  // PostgreSQL retry_at is BIGINT; fractional jitter must not produce fractional milliseconds.
  return Math.floor(Math.min(600_000, 30_000 * 2 ** Math.max(0, attempt - 1) * (1 + Math.max(0, Math.min(1, jitter)))));
}

export function getWorkerProductKey(source: {
  readonly source: string;
  readonly sourceIdentity: string;
  readonly input: { readonly productId?: string };
}): string {
  const id = source.input.productId || (source.source === "auto_seo" ? source.sourceIdentity : "");
  const normalized = id.replace(/^gid:\/\/shopify\/Product\//, "");
  if (normalized) {
    if (!/^\d+$/.test(normalized)) throw new SeoWorkerError("INVALID_SOURCE");
    return `shopify:${normalized}`;
  }
  if (!source.source || !source.sourceIdentity) throw new SeoWorkerError("INVALID_SOURCE");
  return `source:${source.source}:${source.sourceIdentity}`;
}

export interface WorkerLease {
  readonly jobId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly leaseId: string;
  readonly leaseVersion: number;
  readonly expiresAt: number;
}

export interface WorkerRun {
  readonly id: string;
  readonly target: number;
  readonly successful: number;
  readonly state: "RUNNING" | "PARTIAL" | "COMPLETED";
  readonly stopReason: string | null;
}

export interface WorkerPrincipal {
  readonly tokenId: string;
  readonly storeId: string;
  readonly workerId: string;
  readonly expiresAt: number;
  readonly storeIds: readonly string[];
}
