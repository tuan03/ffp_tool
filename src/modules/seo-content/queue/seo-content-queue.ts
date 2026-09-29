import { SeoTimeoutError } from "../internal/pipeline-errors";
import { runSeoContent } from "../service";
import type { SeoContentInput, SeoContentOutput } from "../types";
import type {
  SeoQueueItem,
  SeoQueueOptions,
  SeoQueueProgressStats,
} from "./types";

let globalCounter = 0;

function generateQueueItemId(index: number): string {
  globalCounter += 1;
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `seo-queue-${timePart}-${randomPart}-${index}-${globalCounter}`;
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error("Queue item execution was cancelled.");
  error.name = "AbortError";
  return error;
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw createAbortError(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(createAbortError(signal.reason));
    signal.addEventListener("abort", handleAbort, { once: true });
    void promise.then(
      (val) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener("abort", handleAbort);
        reject(err);
      },
    );
  });
}

/**
 * Universal FIFO Queue Engine cho module SEO Content.
 * Chạy độc lập, không phụ thuộc DOM hay Node runtime nội bộ.
 * Hỗ trợ concurrency 1–3 (mặc định 1), fail-safe khi gặp lỗi, và realtime event streaming.
 */
export class SeoContentQueue<TSource = unknown> {
  private items: SeoQueueItem<TSource>[] = [];
  private readonly options: SeoQueueOptions<TSource>;
  private readonly runner: (
    input: SeoContentInput,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<SeoContentOutput>;
  private readonly concurrency: number;
  private readonly autoStart: boolean;
  private readonly itemTimeoutMs?: number;

  private isPaused = false;
  private runningCount = 0;
  private nextItemIndex = 0;
  private hasDispatchedDrained = true;
  private drainResolvers: Array<(stats: SeoQueueProgressStats) => void> = [];

  constructor(options: SeoQueueOptions<TSource> = {}) {
    this.options = options;
    this.runner = options.runner || runSeoContent;
    const rawConcurrency = typeof options.concurrency === "number" && !Number.isNaN(options.concurrency)
      ? options.concurrency
      : 1;
    this.concurrency = Math.max(1, Math.min(Math.floor(rawConcurrency), 3));
    this.autoStart = options.autoStart ?? true;
    this.itemTimeoutMs = options.itemTimeoutMs;
  }


  /**
   * Bắn sự kiện an toàn, cô lập lỗi callback của người gọi để không ảnh hưởng đến vòng lặp queue.
   */
  private safeEmit<TArgs extends unknown[]>(
    emitter: ((...args: TArgs) => void) | undefined,
    ...args: TArgs
  ): void {
    if (!emitter) return;
    try {
      emitter(...args);
    } catch {
      // Isolate listener error to prevent crashing internal queue loop
    }
  }

  /**
   * Thêm một hoặc nhiều sản phẩm vào cuối hàng đợi.
   */
  public enqueue(
    input: SeoContentInput | readonly SeoContentInput[],
    source?: TSource | readonly TSource[],
  ): readonly SeoQueueItem<TSource>[] {
    const isBatch = Array.isArray(input);
    const inputs = isBatch ? (input as readonly SeoContentInput[]) : [input as SeoContentInput];
    const newItems: SeoQueueItem<TSource>[] = [];

    for (let index = 0; index < inputs.length; index += 1) {
      const currentInput = inputs[index];
      const currentSource = isBatch && Array.isArray(source) ? source[index] : source;
      const abortController = new AbortController();

      const item: SeoQueueItem<TSource> = {
        id: generateQueueItemId(this.nextItemIndex),
        index: this.nextItemIndex,
        seoInput: currentInput,
        abortController,
        ...(currentSource !== undefined ? { source: currentSource as TSource } : {}),
        status: "pending",
        enqueuedAt: Date.now(),
      };

      this.nextItemIndex += 1;
      this.items.push(item);
      newItems.push(item);
      this.hasDispatchedDrained = false;
      this.safeEmit(this.options.onItemEnqueued, item);
    }

    if (newItems.length > 0) {
      this.safeEmit(this.options.onProgress, this.getStats());
      if (this.autoStart && !this.isPaused) {
        this.pump();
      }
    }

    return newItems;
  }

  /**
   * Hủy bỏ / abort một item cụ thể bằng id (cho dù đang pending hay processing).
   * Khi gọi với item đang processing, worker slot sẽ được giải phóng ngay lập tức.
   */
  public abortItem(id: string, reason?: unknown): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;

    if (item.status === "pending") {
      item.status = "cancelled";
      item.completedAt = Date.now();
      item.durationMs = 0;
      item.abortController?.abort(reason);
      this.safeEmit(this.options.onItemCancelled, item);
      this.safeEmit(this.options.onProgress, this.getStats());
      this.pump();
      this.checkDrain();
      return true;
    }

    if (item.status === "processing") {
      item.abortController?.abort(reason);
      return true;
    }

    return false;
  }

  /**
   * Bắt đầu xử lý hàng đợi.
   */
  public start(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this.safeEmit(this.options.onResumed);
      this.safeEmit(this.options.onProgress, this.getStats());
    }
    this.pump();
  }

  /**
   * Tạm dừng hàng đợi (các tác vụ đang chạy vẫn tiếp tục, không lấy thêm tác vụ mới).
   */
  public pause(): void {
    if (!this.isPaused) {
      this.isPaused = true;
      this.safeEmit(this.options.onPaused);
      this.safeEmit(this.options.onProgress, this.getStats());
    }
  }

  /**
   * Tiếp tục xử lý sau khi tạm dừng.
   */
  public resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this.safeEmit(this.options.onResumed);
      this.safeEmit(this.options.onProgress, this.getStats());
      this.pump();
    }
  }

  /**
   * Hủy bỏ toàn bộ các item đang pending (hoặc cả processing nếu abortProcessing = true).
   */
  public cancel(options?: { readonly abortProcessing?: boolean }): void {
    let hasCancelled = false;
    const now = Date.now();

    for (const item of this.items) {
      if (item.status === "pending") {
        item.status = "cancelled";
        item.completedAt = now;
        item.durationMs = 0;
        item.abortController?.abort();
        hasCancelled = true;
      } else if (options?.abortProcessing && item.status === "processing") {
        item.abortController?.abort();
        hasCancelled = true;
      }
    }

    if (hasCancelled) {
      this.safeEmit(this.options.onCancelled);
      this.safeEmit(this.options.onProgress, this.getStats());
    }

    this.checkDrain();
  }

  /**
   * Xóa sạch các item đang pending khỏi hàng đợi.
   */
  public clear(): void {
    const pendingItems = this.items.filter((item) => item.status === "pending");
    for (const item of pendingItems) {
      item.abortController?.abort();
    }
    this.items = this.items.filter((item) => item.status !== "pending");

    if (pendingItems.length > 0) {
      this.safeEmit(this.options.onProgress, this.getStats());
    }

    this.checkDrain();
  }


  /**
   * Trả về thống kê tiến độ tức thời của hàng đợi.
   */
  public getStats(): SeoQueueProgressStats {
    const total = this.items.length;
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const item of this.items) {
      if (item.status === "pending") pending += 1;
      else if (item.status === "processing") processing += 1;
      else if (item.status === "completed") completed += 1;
      else if (item.status === "failed") failed += 1;
      else if (item.status === "cancelled") cancelled += 1;
    }

    const processed = completed + failed + cancelled;
    const percent = total === 0 ? 0 : Math.min(100, Math.round((processed / total) * 100));
    const isRunning = processing > 0 || (pending > 0 && !this.isPaused);

    return {
      total,
      pending,
      processing,
      completed,
      failed,
      cancelled,
      percent,
      isRunning,
      isPaused: this.isPaused,
    };
  }

  /**
   * Lấy bản sao danh sách tất cả các item trong hàng đợi.
   */
  public getItems(): readonly SeoQueueItem<TSource>[] {
    return [...this.items];
  }

  /**
   * Lấy thông tin một item theo id.
   */
  public getItem(id: string): SeoQueueItem<TSource> | undefined {
    return this.items.find((item) => item.id === id);
  }

  /**
   * Chờ cho đến khi toàn bộ hàng đợi được xử lý xong (không còn pending hay processing).
   */
  public waitForDrain(): Promise<SeoQueueProgressStats> {
    const stats = this.getStats();
    if (stats.pending === 0 && stats.processing === 0) {
      return Promise.resolve(stats);
    }

    return new Promise<SeoQueueProgressStats>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  /**
   * Vòng lặp điều phối chính (Worker pump).
   */
  private pump(): void {
    if (this.isPaused) {
      return;
    }

    while (this.runningCount < this.concurrency) {
      const nextItem = this.items.find((item) => item.status === "pending");
      if (!nextItem) {
        break;
      }

      this.hasDispatchedDrained = false;
      const currentItem = nextItem;
      currentItem.status = "processing";
      currentItem.startedAt = Date.now();
      this.runningCount += 1;

      this.safeEmit(this.options.onItemStarted, currentItem);
      this.safeEmit(this.options.onProgress, this.getStats());

      void this.processItem(currentItem);
    }

    this.checkDrain();
  }

  /**
   * Xử lý một queue item riêng lẻ với quản lý timeout, abort, và giải phóng worker slot an toàn.
   */
  private async processItem(currentItem: SeoQueueItem<TSource>): Promise<void> {
    let itemTimer: NodeJS.Timeout | number | undefined;

    if (this.itemTimeoutMs && this.itemTimeoutMs > 0 && Number.isFinite(this.itemTimeoutMs)) {
      itemTimer = setTimeout(() => {
        currentItem.abortController?.abort(
          new SeoTimeoutError(
            "overall",
            this.itemTimeoutMs!,
            `Queue item timed out after ${this.itemTimeoutMs}ms`,
          ),
        );
      }, this.itemTimeoutMs);
      if (typeof (itemTimer as { unref?: () => void })?.unref === "function") {
        (itemTimer as { unref: () => void }).unref();
      }
    }

    try {
      if (currentItem.abortController?.signal.aborted) {
        throw createAbortError(currentItem.abortController.signal.reason);
      }

      const runnerPromise = this.runner(currentItem.seoInput, {
        signal: currentItem.abortController?.signal,
      });
      const output = await awaitWithAbort(runnerPromise, currentItem.abortController?.signal);

      currentItem.status = "completed";
      currentItem.output = output;
      currentItem.completedAt = Date.now();
      currentItem.durationMs = currentItem.completedAt - (currentItem.startedAt ?? currentItem.completedAt);
      this.safeEmit(this.options.onItemCompleted, currentItem, output);
    } catch (err: unknown) {
      const isTimeout =
        err instanceof SeoTimeoutError ||
        (err instanceof Error &&
          (err.name === "SeoTimeoutError" || (err as { code?: string }).code === "SEO_TIMEOUT"));

      const isAborted =
        !isTimeout &&
        (Boolean(currentItem.abortController?.signal.aborted) ||
          (err instanceof Error && err.name === "AbortError"));

      if (isAborted) {
        currentItem.status = "cancelled";
      } else {
        currentItem.status = "failed";
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      currentItem.error = errorMessage;
      currentItem.completedAt = Date.now();
      currentItem.durationMs = currentItem.completedAt - (currentItem.startedAt ?? currentItem.completedAt);

      if (isAborted) {
        this.safeEmit(this.options.onItemCancelled, currentItem);
      }
      this.safeEmit(this.options.onItemFailed, currentItem, errorMessage);
    } finally {
      if (itemTimer !== undefined) {
        clearTimeout(itemTimer);
      }
      this.runningCount -= 1;
      this.safeEmit(this.options.onProgress, this.getStats());
      this.pump();
      this.checkDrain();
    }
  }


  /**
   * Kiểm tra điều kiện cạn hàng đợi (drain) và kích hoạt callbacks/resolvers tương ứng.
   */
  private checkDrain(): void {
    const stats = this.getStats();
    if (stats.pending === 0 && stats.processing === 0) {
      if (!this.hasDispatchedDrained) {
        this.hasDispatchedDrained = true;
        this.safeEmit(this.options.onDrained, stats);
      }

      if (this.drainResolvers.length > 0) {
        const resolvers = [...this.drainResolvers];
        this.drainResolvers = [];
        for (const resolve of resolvers) {
          try {
            resolve(stats);
          } catch {
            // Protect against unexpected resolver errors
          }
        }
      }
    }
  }
}

/**
 * Factory tạo nhanh một instance SeoContentQueue.
 */
export function createSeoContentQueue<TSource = unknown>(
  options: SeoQueueOptions<TSource> = {},
): SeoContentQueue<TSource> {
  return new SeoContentQueue<TSource>(options);
}
