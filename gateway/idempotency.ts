import { createHash } from "node:crypto";

export type IdempotencyState = "PENDING" | "COMPLETED" | "RECONCILIATION_REQUIRED";

export interface IdempotencyEntry {
  readonly state: IdempotencyState;
  readonly operation: string;
  readonly payloadHash: string;
  readonly responseData?: unknown;
  readonly details?: Record<string, unknown>;
  readonly createdAtMs: number;
}

/**
 * Idempotency storage interface for managing write mutation deduplication.
 *
 * Implementations must satisfy:
 * 1. Distributed Multi-Instance Safety: When replaced with Redis or a distributed DB,
 *    `set` operations for "PENDING" state should behave atomically (e.g. SETNX or conditional insert)
 *    to prevent concurrent duplicate execution across multiple gateway replicas.
 * 2. TTL Expiration: Entries should expire and be evicted automatically after TTL to prevent
 *    unbounded memory growth.
 * 3. Serialization: `responseData` and `details` must be JSON-serializable payloads.
 */
export interface IdempotencyStore {
  /**
   * Retrieves the current idempotency record for a given idempotency key.
   * Returns null if not found or expired.
   */
  get(key: string): Promise<IdempotencyEntry | null>;

  /**
   * Stores or updates an idempotency record for a given key with an optional TTL in milliseconds.
   * If `ttlMs` is omitted, the store's default TTL is applied.
   */
  set(key: string, entry: IdempotencyEntry, ttlMs?: number): Promise<void>;

  /**
   * Deletes an idempotency record for a given key (e.g. during rollback or retry eviction).
   */
  delete(key: string): Promise<void>;

  /**
   * Clears all idempotency records from the store.
   */
  clear(): Promise<void> | void;

  /**
   * Optional maintenance method to proactively prune expired entries.
   * Returns the number of expired entries removed.
   */
  prune?(): Promise<number> | number;

  /**
   * Optional cleanup method to release background timers and connections.
   */
  destroy?(): Promise<void> | void;
}

export function deterministicStringify(val: unknown): string {
  if (val === undefined) {
    return "null";
  }
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map((item) => (item === undefined ? "null" : deterministicStringify(item))).join(",")}]`;
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  const pairs: string[] = [];
  for (const k of keys) {
    const v = (val as Record<string, unknown>)[k];
    if (v !== undefined) {
      pairs.push(`${JSON.stringify(k)}:${deterministicStringify(v)}`);
    }
  }
  return `{${pairs.join(",")}}`;
}

export function calculateCanonicalHash(operation: string, payload: unknown): string {
  const canonical = `${operation}:${deterministicStringify(payload)}`;
  return createHash("sha256").update(canonical).digest("hex");
}

export interface InMemoryIdempotencyStoreOptions {
  /** Default TTL in milliseconds for entries if unspecified in set() (defaults to 3,600,000 = 1 hour) */
  readonly defaultTtlMs?: number;
  /** Interval in milliseconds for background pruning of expired entries (defaults to 60,000 = 1 minute; 0 to disable) */
  readonly pruneIntervalMs?: number;
  /** Maximum number of entries before proactive pruning is triggered on set() (defaults to 10,000) */
  readonly maxEntries?: number;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, { entry: IdempotencyEntry; expiresAtMs: number }>();
  private readonly defaultTtlMs: number;
  private readonly pruneIntervalMs: number;
  private readonly maxEntries: number;
  private pruneTimer?: ReturnType<typeof setInterval>;

  public constructor(optionsOrDefaultTtl?: number | InMemoryIdempotencyStoreOptions) {
    if (typeof optionsOrDefaultTtl === "number") {
      this.defaultTtlMs = optionsOrDefaultTtl > 0 ? optionsOrDefaultTtl : 3_600_000;
      this.pruneIntervalMs = 60_000;
      this.maxEntries = 10_000;
    } else {
      this.defaultTtlMs = optionsOrDefaultTtl?.defaultTtlMs && optionsOrDefaultTtl.defaultTtlMs > 0
        ? optionsOrDefaultTtl.defaultTtlMs
        : 3_600_000;
      this.pruneIntervalMs = optionsOrDefaultTtl?.pruneIntervalMs !== undefined
        ? Math.max(0, optionsOrDefaultTtl.pruneIntervalMs)
        : 60_000;
      this.maxEntries = optionsOrDefaultTtl?.maxEntries && optionsOrDefaultTtl.maxEntries > 0
        ? optionsOrDefaultTtl.maxEntries
        : 10_000;
    }

    if (this.pruneIntervalMs > 0 && typeof setInterval !== "undefined") {
      this.pruneTimer = setInterval(() => {
        this.pruneExpired();
      }, this.pruneIntervalMs);
      if (
        typeof this.pruneTimer === "object" &&
        this.pruneTimer !== null &&
        "unref" in this.pruneTimer &&
        typeof (this.pruneTimer as { unref: () => void }).unref === "function"
      ) {
        (this.pruneTimer as { unref: () => void }).unref();
      }
    }
  }

  /**
   * Actively scans and removes all expired entries from memory.
   * Returns the number of pruned entries.
   */
  public pruneExpired(): number {
    const now = Date.now();
    let prunedCount = 0;
    for (const [key, item] of this.store.entries()) {
      if (now > item.expiresAtMs) {
        this.store.delete(key);
        prunedCount++;
      }
    }
    return prunedCount;
  }

  public prune(): number {
    return this.pruneExpired();
  }

  public async get(key: string): Promise<IdempotencyEntry | null> {
    const item = this.store.get(key);
    if (!item) {
      return null;
    }
    if (Date.now() > item.expiresAtMs) {
      this.store.delete(key);
      return null;
    }
    return item.entry;
  }

  public async set(key: string, entry: IdempotencyEntry, ttlMs?: number): Promise<void> {
    if (this.store.size >= this.maxEntries) {
      this.pruneExpired();
      while (this.store.size >= this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        this.store.delete(oldestKey);
      }
    }

    const ttl = ttlMs !== undefined && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    this.store.delete(key);
    this.store.set(key, {
      entry,
      expiresAtMs: Date.now() + ttl,
    });
  }

  public async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public destroy(): void {
    if (this.pruneTimer !== undefined) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }
  }
}
