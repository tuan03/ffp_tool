export type EmbeddingTaskType =
  | "RETRIEVAL_QUERY"
  | "RETRIEVAL_DOCUMENT"
  | "SEMANTIC_SIMILARITY";

export interface EmbeddingOptions {
  readonly taskType: EmbeddingTaskType;
  readonly model?: string;
}

/**
 * Common abstraction for text embedding providers (Vertex AI or Deterministic Local).
 */
export interface TextEmbeddingProvider {
  readonly providerId: string;
  embed(
    texts: readonly string[],
    options: EmbeddingOptions,
  ): Promise<readonly (readonly number[])[]>;
}
