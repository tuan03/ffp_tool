import { AsyncSemaphore } from "./product-understanding/async-semaphore";

export type ProviderKind = "gemini" | "embedding" | "suggest";
export interface ProviderMetric {
  readonly queueMs?: number;
  readonly requestMs?: number;
  readonly retryWaitMs?: number;
  readonly cacheHit?: boolean;
}
export interface ProviderRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onMetric?: (metric: ProviderMetric) => void;
}

const limits = new Map<ProviderKind, AsyncSemaphore>();
const suggestStartGate = new AsyncSemaphore(1);
let lastSuggestStart = 0;

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); reject(signal?.reason); };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function limiter(kind: ProviderKind): AsyncSemaphore {
  let limit = limits.get(kind);
  if (!limit) {
    const env = typeof process !== "undefined" ? process.env : {};
    const raw = kind === "gemini" ? env.GEMINI_REQUEST_CONCURRENCY ?? env.GEMINI_VISION_CONCURRENCY
      : kind === "embedding" ? env.SEO_EMBEDDING_CONCURRENCY : env.SEO_SUGGEST_CONCURRENCY;
    const fallback = kind === "gemini" ? 4 : kind === "embedding" ? 2 : 3;
    const count = Number(raw ?? fallback);
    limit = new AsyncSemaphore(Number.isInteger(count) && count > 0 ? Math.min(count, kind === "suggest" ? 3 : 16) : fallback);
    limits.set(kind, limit);
  }
  return limit;
}

/** Each attempt holds a slot only while executing; retries acquire again after backoff. */
export async function runProviderRequest<T>(
  kind: ProviderKind, operation: (signal: AbortSignal) => Promise<T>, options: ProviderRequestOptions = {},
): Promise<T> {
  const queuedAt = Date.now();
  const release = await limiter(kind).acquire(options.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  let startedAt: number | undefined;
  try {
    options.signal?.throwIfAborted();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (kind === "suggest") {
      await suggestStartGate.runExclusive(async () => {
        await abortableDelay(Math.max(0, lastSuggestStart + 250 - Date.now()), controller.signal);
        controller.signal.throwIfAborted();
        lastSuggestStart = Date.now();
      }, controller.signal);
    }
    controller.signal.throwIfAborted();
    startedAt = Date.now();
    options.onMetric?.({ queueMs: startedAt - queuedAt });
    timer = setTimeout(() => controller.abort(new DOMException("Provider request timed out", "TimeoutError")), options.timeoutMs ?? 25_000);
    const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    release();
    if (startedAt !== undefined) options.onMetric?.({ requestMs: Date.now() - startedAt });
  }
}
