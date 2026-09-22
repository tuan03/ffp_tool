import { canonicalKey } from "./search-suggestions-normalizer";

export interface GoogleSuggestCache {
  get(key: string): readonly string[] | undefined;
  set(key: string, suggestions: readonly string[]): void;
  has?(key: string): boolean;
  clear?(): void;
  size?(): number;
}

export interface InMemorySuggestCacheOptions {
  readonly ttlMs?: number;
  readonly maxSize?: number;
}

export const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_CACHE_MAX_SIZE = 500; // max 500 cached queries

interface CacheEntry {
  readonly suggestions: readonly string[];
  readonly expiresAt: number;
}

export function createSuggestCacheKey(
  query: string,
  language = "en",
  country = "us",
): string {
  const normLang = language.trim().toLowerCase() || "en";
  const normCountry = country.trim().toLowerCase() || "us";
  const normQueryKey = canonicalKey(query);
  return `${normLang}:${normCountry}:${normQueryKey}`;
}

export class InMemoryGoogleSuggestCache implements GoogleSuggestCache {
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options?: InMemorySuggestCacheOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxSize = options?.maxSize ?? DEFAULT_CACHE_MAX_SIZE;
  }

  get(key: string): readonly string[] | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU order on hit
    this.cache.delete(key);
    this.cache.set(key, entry);

    return [...entry.suggestions];
  }

  set(key: string, suggestions: readonly string[]): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.cache.set(key, {
      suggestions: [...suggestions],
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export const defaultGoogleSuggestCache = new InMemoryGoogleSuggestCache();
