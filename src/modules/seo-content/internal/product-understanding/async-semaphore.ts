/**
 * Lightweight, zero-dependency FIFO AsyncSemaphore for controlling concurrency.
 */
export class AsyncSemaphore {
  private _activeCount = 0;
  private readonly _waitingQueue: Array<() => void> = [];
  private readonly _maxConcurrency: number;

  constructor(maxConcurrency: number = 1) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error(
        `AsyncSemaphore maxConcurrency must be a positive integer, got ${maxConcurrency}`,
      );
    }
    this._maxConcurrency = maxConcurrency;
  }

  get activeCount(): number {
    return this._activeCount;
  }

  get waitingCount(): number {
    return this._waitingQueue.length;
  }

  get maxConcurrency(): number {
    return this._maxConcurrency;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this._activeCount < this._maxConcurrency) {
      this._activeCount++;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", cancel);
        resolve(this.createRelease());
      };
      const cancel = () => {
        const index = this._waitingQueue.indexOf(grant);
        if (index >= 0) this._waitingQueue.splice(index, 1);
        reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
      };
      this._waitingQueue.push(grant);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const next = this._waitingQueue.shift();
      if (next) {
        next();
      } else {
        this._activeCount = Math.max(0, this._activeCount - 1);
      }
    };
  }

  async runExclusive<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      signal?.throwIfAborted();
      return await fn();
    } finally {
      release();
    }
  }
}

let sharedGeminiVisionSemaphore: AsyncSemaphore | undefined;

/**
 * Returns the process-wide shared semaphore for Gemini Vision calls.
 * If not already initialized, uses maxConcurrency or reads GEMINI_VISION_CONCURRENCY (default 1).
 */
export function getSharedGeminiVisionSemaphore(maxConcurrency?: number): AsyncSemaphore {
  if (!sharedGeminiVisionSemaphore) {
    const envConcurrency =
      typeof process !== "undefined" && process.env?.GEMINI_VISION_CONCURRENCY
        ? Number(process.env.GEMINI_VISION_CONCURRENCY)
        : undefined;
    const concurrency =
      maxConcurrency ??
      (Number.isInteger(envConcurrency) && envConcurrency! > 0
        ? envConcurrency!
        : 1);
    sharedGeminiVisionSemaphore = new AsyncSemaphore(concurrency);
  }
  return sharedGeminiVisionSemaphore;
}

/**
 * Resets the process-wide shared semaphore (primarily used for unit testing).
 */
export function resetSharedGeminiVisionSemaphore(): void {
  sharedGeminiVisionSemaphore = undefined;
}
