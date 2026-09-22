export interface StoredEmbedding {
  readonly values: readonly number[];
  readonly provider: string;
  readonly model: string;
  readonly taskType: string;
  readonly dimensions: number;
}

export interface ExistingSeoTarget {
  readonly url: string;
  readonly primaryKeyword: string;
  readonly embedding?: StoredEmbedding;
}

export interface SeoConflictCorpus {
  findConflicts(
    keyword: string,
    vector?: StoredEmbedding | readonly number[],
  ): Promise<readonly ExistingSeoTarget[]>;
}

/**
 * Validates vector space compatibility before computing similarities against corpus targets.
 * Prevents comparing vectors across different models, providers, or dimensions.
 */
export function isEmbeddingCompatible(
  a: StoredEmbedding | undefined,
  b: StoredEmbedding | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  const isProviderCompatible =
    a.provider === b.provider ||
    ((a.provider === "vertex" || a.provider === "vertex_ai") &&
      (b.provider === "vertex" || b.provider === "vertex_ai"));

  return (
    isProviderCompatible &&
    a.model === b.model &&
    a.taskType === b.taskType &&
    a.dimensions === b.dimensions &&
    a.values.length === b.values.length
  );
}


