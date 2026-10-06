/**
 * FFP Ads Intelligence — Cost Guard & In-Memory TTL Cache
 * Prevents redundant external API calls to Meta Graph API, GA4, and Competitor Spy.
 */

export interface CacheEntry<T> {
  readonly data: T;
  readonly cachedAt: string;
  readonly expiresAt: string;
}

export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly keysCount: number;
  readonly lastSyncedAt: string | null;
}

export class AdsIntelligenceCache {
  private readonly store = new Map<string, { value: unknown; expiresAtMs: number; cachedAtIso: string }>();
  private hits = 0;
  private misses = 0;
  private lastSyncedAt: string | null = null;

  // Default TTL: 15 minutes (900_000 ms) for near-term mutable data
  constructor(private readonly defaultTtlMs = 15 * 60 * 1000) {}

  get<T>(key: string): CacheEntry<T> | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAtMs) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return {
      data: entry.value as T,
      cachedAt: entry.cachedAtIso,
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
    };
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const now = Date.now();
    const expiresAtMs = now + ttl;
    const cachedAtIso = new Date(now).toISOString();

    this.store.set(key, {
      value: data,
      expiresAtMs,
      cachedAtIso,
    });
    this.lastSyncedAt = cachedAtIso;
  }

  invalidate(prefix?: string): number {
    if (!prefix) {
      const count = this.store.size;
      this.store.clear();
      return count;
    }

    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      keysCount: this.store.size,
      lastSyncedAt: this.lastSyncedAt,
    };
  }
}

// Global singleton cache instance for Ads Intelligence runtime
export const adsIntelligenceCache = new AdsIntelligenceCache();
