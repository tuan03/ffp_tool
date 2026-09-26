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

  async acquire(): Promise<() => void> {
    if (this._activeCount < this._maxConcurrency) {
      this._activeCount++;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this._waitingQueue.push(() => {
        resolve(this.createRelease());
      });
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

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
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
