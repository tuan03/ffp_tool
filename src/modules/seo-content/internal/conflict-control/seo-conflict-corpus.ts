export interface StoredEmbedding {
  readonly values: readonly number[];
  readonly provider: string;
  readonly model: string;
  readonly taskType: string;
  readonly dimensions: number;
  readonly vectorSpaceId?: string;
  readonly reusableAcrossRuns?: boolean;
}

export interface SeoProductIdentity {
  readonly storeId?: string;
  readonly productId?: string;
  readonly handle?: string;
  readonly url?: string;
}

export interface ExistingSeoTarget {
  readonly url: string;
  readonly primaryKeyword: string;
  readonly productKey?: string;
  readonly productId?: string;
  readonly handle?: string;
  readonly title?: string;
  readonly keyword?: string;
  readonly normalizedKeyword?: string;
  readonly rank?: number;
  readonly matchType?: "exact" | "semantic";
  readonly similarity?: number;
  readonly embedding?: StoredEmbedding;
}

export interface SeoConflictLookup {
  readonly keyword: string;
  readonly normalizedKeyword?: string;
  readonly owner?: SeoProductIdentity;
  readonly embedding?: StoredEmbedding;
  readonly semanticThreshold?: number;
  readonly snapshot?: SeoConflictCorpusFile;
  readonly productCategory?: string;
  readonly productTitle?: string;
}

export interface SeoRegisteredKeyword {
  readonly keyword: string;
  readonly normalizedKeyword?: string;
  readonly rank: number;
  readonly embedding?: StoredEmbedding;
}

export interface SeoProductKeywordRegistration {
  readonly identity: SeoProductIdentity;
  readonly title?: string;
  readonly approvedKeywords: readonly (SeoRegisteredKeyword | string)[];
  readonly expectedRevision?: number;
}

export interface SeoCorpusKeyword {
  readonly keyword: string;
  readonly normalizedKeyword: string;
  readonly rank: number;
  readonly embedding?: StoredEmbedding;
}

export interface SeoCorpusProduct {
  readonly storeId?: string;
  readonly productKey: string;
  readonly productId?: string;
  readonly handle?: string;
  readonly url?: string;
  readonly title?: string;
  readonly updatedAt: string;
  readonly keywords: readonly SeoCorpusKeyword[];
}

export interface SeoConflictCorpusFile {
  readonly schemaVersion: 1;
  readonly normalizationVersion: 1;
  readonly revision: number;
  readonly updatedAt: string;
  readonly products: readonly SeoCorpusProduct[];
}

export interface CatalogConflictThresholds {
  readonly semanticStrong: number;
  readonly semanticReview: number;
}

export const DEFAULT_CATALOG_CONFLICT_THRESHOLDS: CatalogConflictThresholds = {
  semanticStrong: 0.90,
  semanticReview: 0.86,
};

export interface SeoConflictCorpus {
  findConflicts(
    inputOrKeyword: SeoConflictLookup | string,
    vector?: StoredEmbedding | readonly number[],
  ): Promise<readonly ExistingSeoTarget[]>;

  upsertProduct?(
    registration: SeoProductKeywordRegistration,
  ): Promise<{ revision: number }>;

  removeProduct?(
    identity: SeoProductIdentity,
  ): Promise<void>;

  getSnapshot?(): Promise<SeoConflictCorpusFile>;
}

/**
 * Validates vector space compatibility before computing similarities against corpus targets.
 * Prevents comparing vectors across different models, providers, dimensions, or incompatible vector spaces.
 * Enforces that ephemeral/local embeddings (reusableAcrossRuns === false) are never reused across runs.
 */
export function isEmbeddingCompatible(
  a: StoredEmbedding | undefined,
  b: StoredEmbedding | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }

  // Persistent embedding reuse rule: never reuse dynamic/session embeddings across runs
  if (a.reusableAcrossRuns === false || b.reusableAcrossRuns === false) {
    // Only compatible if they share the exact same non-empty vectorSpaceId
    if (!a.vectorSpaceId || !b.vectorSpaceId || a.vectorSpaceId !== b.vectorSpaceId) {
      return false;
    }
  }

  const isProviderCompatible =
    a.provider === b.provider ||
    ((a.provider === "vertex" || a.provider === "vertex_ai") &&
      (b.provider === "vertex" || b.provider === "vertex_ai"));

  const isBasicCompatible =
    isProviderCompatible &&
    a.model === b.model &&
    a.taskType === b.taskType &&
    a.dimensions === b.dimensions &&
    a.values.length === b.values.length;

  if (!isBasicCompatible) {
    return false;
  }

  // If both have vectorSpaceId defined, they must match
  if (a.vectorSpaceId && b.vectorSpaceId && a.vectorSpaceId !== b.vectorSpaceId) {
    return false;
  }

  return true;
}

/**
 * Normalizes identifier strings (removes leading/trailing slashes, trims whitespace, lowercase).
 */
function normalizeIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  return trimmed.replace(/^\/+|\/+$/g, "");
}

/**
 * Checks if two product identities refer to the same catalog product.
 * Evaluates identifiers hierarchically:
 * 1. If both have productId, they match if and only if productIds match (different productIds never match).
 * 2. If productId is unavailable on at least one, checks handles (different handles never match).
 * 3. If handle is unavailable on at least one, checks URLs.
 */
export function isSameProduct(
  a: SeoProductIdentity | undefined,
  b: SeoProductIdentity | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  const storeA = a.storeId ? a.storeId.trim() : undefined;
  const storeB = b.storeId ? b.storeId.trim() : undefined;
  if (storeA && storeB && storeA !== storeB) {
    return false;
  }
  const idA = a.productId ? a.productId.trim() : undefined;
  const idB = b.productId ? b.productId.trim() : undefined;
  if (idA && idB) {
    return idA === idB;
  }

  const normHandleA = normalizeIdentifier(a.handle);
  const normHandleB = normalizeIdentifier(b.handle);
  if (normHandleA && normHandleB) {
    return normHandleA === normHandleB;
  }

  const normUrlA = normalizeIdentifier(a.url);
  const normUrlB = normalizeIdentifier(b.url);
  if (normUrlA && normUrlB) {
    return normUrlA === normUrlB;
  }

  return false;
}

/**
 * Generates a stable unique productKey based on the highest priority identifier:
 * productId -> handle -> url.
 */
export function computeProductKey(identity: SeoProductIdentity): string {
  const storePrefix =
    identity.storeId && identity.storeId.trim().length > 0
      ? `store:${identity.storeId.trim()}:`
      : "";
  if (identity.productId && identity.productId.trim().length > 0) {
    return `${storePrefix}id:${identity.productId.trim()}`;
  }
  const normHandle = normalizeIdentifier(identity.handle);
  if (normHandle) {
    return `${storePrefix}handle:${normHandle}`;
  }
  const normUrl = normalizeIdentifier(identity.url);
  if (normUrl) {
    return `${storePrefix}url:${normUrl}`;
  }
  return `${storePrefix}unknown:${Date.now()}`;
}
