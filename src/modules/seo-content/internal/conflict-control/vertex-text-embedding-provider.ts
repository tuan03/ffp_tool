import { GoogleGenAI } from "@google/genai";

import type {
  EmbeddingOptions,
  TextEmbeddingProvider,
} from "./text-embedding-provider";

export interface VertexTextEmbeddingProviderConfig {
  readonly projectId: string;
  readonly location?: string;
  readonly defaultModel?: string;
  readonly timeoutMs?: number;
  readonly client?: {
    models: {
      embedContent(params: {
        model: string;
        contents: string | string[];
        config?: Record<string, unknown>;
      }): Promise<{
        embedding?: { values?: number[] };
        embeddings?: Array<{ values?: number[] }>;
      }>;
    };
  };
}

export class VertexTextEmbeddingError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VertexTextEmbeddingError";
  }
}

/**
 * Production Vertex AI Text Embedding provider using @google/genai SDK.
 * Supports configurable models (text-embedding-004, text-embedding-005) and task types.
 */
export class VertexTextEmbeddingProvider implements TextEmbeddingProvider {
  public readonly providerId = "vertex_ai";
  private readonly projectId: string;
  private readonly location: string;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;
  private readonly client: {
    models: {
      embedContent(params: {
        model: string;
        contents: string | string[];
        config?: Record<string, unknown>;
      }): Promise<{
        embedding?: { values?: number[] };
        embeddings?: Array<{ values?: number[] }>;
      }>;
    };
  };

  constructor(config: VertexTextEmbeddingProviderConfig) {
    if (!config.projectId) {
      throw new VertexTextEmbeddingError("Vertex AI requires a valid projectId");
    }
    this.projectId = config.projectId;
    this.location = config.location || "global";
    this.defaultModel = config.defaultModel || "text-embedding-004";
    this.defaultTimeoutMs = config.timeoutMs || 25000;

    if (config.client) {
      this.client = config.client;
    } else {
      this.client = new GoogleGenAI({
        vertexai: true,
        project: this.projectId,
        location: this.location,
      });
    }
  }

  async embed(
    texts: readonly string[],
    options: EmbeddingOptions,
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) {
      return [];
    }

    const model = options.model || this.defaultModel;
    const taskType = options.taskType;

    // Batch chunking: process up to 32 items per call for API reliability
    const BATCH_SIZE = 32;
    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const chunk = texts.slice(i, i + BATCH_SIZE);
      let timer: NodeJS.Timeout | undefined;

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new VertexTextEmbeddingError(
                `Vertex embedding request timed out after ${this.defaultTimeoutMs}ms`,
              ),
            );
          }, this.defaultTimeoutMs);
        });

        const embedPromise = this.client.models.embedContent({
          model,
          contents: chunk.length === 1 ? chunk[0] : [...chunk],
          config: {
            taskType,
          },
        });

        const res = await Promise.race([embedPromise, timeoutPromise]);

        if (res.embeddings && Array.isArray(res.embeddings)) {
          for (const item of res.embeddings) {
            allVectors.push(item.values ?? []);
          }
        } else if (res.embedding?.values) {
          allVectors.push(res.embedding.values);
        } else {
          throw new VertexTextEmbeddingError(
            "Vertex AI embedContent returned no embedding values",
          );
        }
      } catch (err) {
        if (err instanceof VertexTextEmbeddingError) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new VertexTextEmbeddingError(
          `Vertex AI embedContent failed: ${message}`,
          err,
        );
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }

    return allVectors;
  }
}
