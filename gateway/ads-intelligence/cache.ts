/**
 * FFP Ads Intelligence — Cost Guard & In-Memory TTL Cache with In-Flight Coalescing
 * Prevents redundant external API calls and thundering herd / cache stampede on Meta Graph API, GA4, and Competitor Spy.
 */

export interface CacheEntry<T> {
  readonly data: T;
  readonly cachedAt: string;
  readonly expiresAt: string;
  readonly isStale?: boolean;
}

export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly hitRatio: number;
  readonly coalesced: number;
  readonly inFlightCount: number;
  readonly keysCount: number;
  readonly totalKeys: number;
  readonly lastSyncedAt: string | null;
}

export class AdsIntelligenceCache {
  private readonly store = new Map<
    string,
    { value: unknown; expiresAtMs: number; staleExpiresAtMs: number; cachedAtIso: string }
  >();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private hits = 0;
  private misses = 0;
  private coalesced = 0;
  private lastSyncedAt: string | null = null;

  private cleanupTimer?: NodeJS.Timeout;

  // Default TTL: 15 minutes (900_000 ms), Default Stale Grace: 60 minutes (3_600_000 ms), Default Max: 1000 entries
  constructor(
    private readonly defaultTtlMs = 15 * 60 * 1000,
    private readonly defaultStaleGraceMs = 60 * 60 * 1000,
    private readonly maxEntries = 1000,
    cleanupIntervalMs = 10 * 60 * 1000
  ) {
    if (cleanupIntervalMs > 0 && typeof setInterval === "function") {
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpired();
      }, cleanupIntervalMs);
      this.cleanupTimer.unref?.();
    }
  }

  cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.staleExpiresAtMs) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  get<T>(key: string, allowStale = false): CacheEntry<T> | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAtMs) {
      if (allowStale && now <= entry.staleExpiresAtMs) {
        this.hits++;
        return {
          data: entry.value as T,
          cachedAt: entry.cachedAtIso,
          expiresAt: new Date(entry.expiresAtMs).toISOString(),
          isStale: true,
        };
      }
      if (now > entry.staleExpiresAtMs) {
        this.store.delete(key);
      }
      this.misses++;
      return null;
    }

    this.hits++;
    return {
      data: entry.value as T,
      cachedAt: entry.cachedAtIso,
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      isStale: false,
    };
  }

  set<T>(key: string, data: T, ttlMs?: number, staleGraceMs?: number): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.cleanupExpired();
      if (this.store.size >= this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey !== undefined) {
          this.store.delete(oldestKey);
        }
      }
    }

    const ttl = ttlMs ?? this.defaultTtlMs;
    const staleGrace = staleGraceMs ?? this.defaultStaleGraceMs;
    const now = Date.now();
    const expiresAtMs = now + ttl;
    const staleExpiresAtMs = expiresAtMs + staleGrace;
    const cachedAtIso = new Date(now).toISOString();

    this.store.set(key, {
      value: data,
      expiresAtMs,
      staleExpiresAtMs,
      cachedAtIso,
    });
    this.lastSyncedAt = cachedAtIso;
  }

  getInFlight<T>(key: string): Promise<T> | null {
    const existing = this.inFlight.get(key);
    if (existing) {
      this.coalesced++;
      return existing as Promise<T>;
    }
    return null;
  }

  trackInFlight<T>(key: string, taskPromise: Promise<T>): Promise<T> {
    const wrapped = taskPromise.finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, wrapped);
    return wrapped;
  }

  invalidate(prefix?: string): number {
    if (!prefix) {
      const count = this.store.size;
      this.store.clear();
      this.inFlight.clear();
      return count;
    }

    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed++;
      }
    }
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) {
        this.inFlight.delete(key);
      }
    }
    return removed;
  }

  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRatio = totalRequests > 0 ? Number((this.hits / totalRequests).toFixed(3)) : 0;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRatio,
      coalesced: this.coalesced,
      inFlightCount: this.inFlight.size,
      keysCount: this.store.size,
      totalKeys: this.store.size,
      lastSyncedAt: this.lastSyncedAt,
    };
  }
}

// Global singleton cache instance for Ads Intelligence runtime
export const adsIntelligenceCache = new AdsIntelligenceCache();
