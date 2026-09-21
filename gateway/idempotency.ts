export interface IdempotencyEntry {
  readonly payloadHash: string;
  readonly responseData: unknown;
  readonly createdAtMs: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyEntry | null>;
  set(key: string, entry: IdempotencyEntry, ttlMs?: number): Promise<void>;
}

export function deterministicStringify(val: unknown): string {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map(deterministicStringify).join(",")}]`;
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${deterministicStringify((val as Record<string, unknown>)[k])}`,
  );
  return `{${pairs.join(",")}}`;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, { entry: IdempotencyEntry; expiresAtMs: number }>();
  private readonly defaultTtlMs: number;

  public constructor(defaultTtlMs: number = 3_600_000) {
    this.defaultTtlMs = defaultTtlMs;
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
    const ttl = ttlMs !== undefined && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    this.store.set(key, {
      entry,
      expiresAtMs: Date.now() + ttl,
    });
  }

  public clear(): void {
    this.store.clear();
  }
}
