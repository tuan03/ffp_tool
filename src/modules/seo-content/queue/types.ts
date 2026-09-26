import type { SeoContentInput, SeoContentOutput } from "../types";

export type SeoQueueItemStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface SeoQueueItem<TSource = unknown> {
  readonly id: string;
  readonly index: number;
  readonly seoInput: SeoContentInput;
  readonly source?: TSource;
  status: SeoQueueItemStatus;
  output?: SeoContentOutput;
  error?: string;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface SeoQueueProgressStats {
  readonly total: number;
  readonly pending: number;
  readonly processing: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly percent: number; // 0 -> 100
  readonly isRunning: boolean;
  readonly isPaused: boolean;
}

export interface SeoQueueEvents<TSource = unknown> {
  onItemEnqueued?: (item: SeoQueueItem<TSource>) => void;
  onItemStarted?: (item: SeoQueueItem<TSource>) => void;
  onItemCompleted?: (item: SeoQueueItem<TSource>, output: SeoContentOutput) => void;
  onItemFailed?: (item: SeoQueueItem<TSource>, error: string) => void;
  onProgress?: (stats: SeoQueueProgressStats) => void;
  onDrained?: (stats: SeoQueueProgressStats) => void;
  onPaused?: () => void;
  onResumed?: () => void;
  onCancelled?: () => void;
}

export interface SeoQueueOptions<TSource = unknown> extends SeoQueueEvents<TSource> {
  /** Runner thực thi SEO (mặc định: runSeoContent) */
  readonly runner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
  /** Số tác vụ chạy đồng thời (mặc định: 1, tối đa 3) */
  readonly concurrency?: number;
  /** Tự động bắt đầu chạy ngay khi enqueue (mặc định: true) */
  readonly autoStart?: boolean;
}
