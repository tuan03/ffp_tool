import { GoogleGenAI } from "@google/genai";

import { runProviderRequest, type ProviderRequestOptions } from "../provider-runtime";
import { executeWithExponentialBackoff } from "../product-understanding/gemini-retry";

interface CachedVector { readonly values: readonly number[]; readonly expiresAt: number }
const sharedVectors = new Map<string, CachedVector>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 10_000;

import type {
  EmbeddingOptions,
  TextEmbeddingProvider,
} from "./text-embedding-provider";

export interface VertexTextEmbeddingProviderConfig extends ProviderRequestOptions {
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

  private readonly vectors: Map<string, CachedVector>;

  constructor(private readonly config: VertexTextEmbeddingProviderConfig) {
    this.vectors = config.client ? new Map() : sharedVectors;
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
    this.config.signal?.throwIfAborted();
    if (texts.length === 0) return [];
    const model = options.model || this.defaultModel;
    const keyFor = (text: string) => JSON.stringify([
      this.providerId, this.projectId, this.location, model, options.taskType, "native-dimensions", text,
    ]);
    const vectors = new Map<string, readonly number[]>();
    const missing: string[] = [];
    for (const text of new Set(texts)) {
      const key = keyFor(text);
      const cached = this.vectors.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        this.vectors.delete(key);
        this.vectors.set(key, cached);
        vectors.set(text, cached.values);
        this.config.onMetric?.({ cacheHit: true });
      } else {
        this.vectors.delete(key);
        missing.push(text);
      }
    }
    for (let i = 0; i < missing.length; i += 32) {
      const chunk = missing.slice(i, i + 32);
      try {
        const response = await executeWithExponentialBackoff(() => runProviderRequest("embedding", signal =>
          this.client.models.embedContent({
            model,
            contents: chunk.length === 1 ? chunk[0] : chunk,
            config: { taskType: options.taskType, abortSignal: signal, httpOptions: { retryOptions: { attempts: 1 } } },
          }), { ...this.config, timeoutMs: this.defaultTimeoutMs }), {
            signal: this.config.signal,
            onRetry: (_error, _attempt, retryWaitMs) => this.config.onMetric?.({ retryWaitMs }),
          });
        const returned = response.embeddings?.map(embedding => embedding.values)
          ?? (response.embedding ? [response.embedding.values] : []);
        const dimension = returned[0]?.length;
        if (returned.length !== chunk.length || !dimension || returned.some(vector =>
          !vector || vector.length !== dimension || vector.some(value => !Number.isFinite(value)))) {
          throw new VertexTextEmbeddingError("Vertex AI returned invalid or incomplete embedding vectors");
        }
        returned.forEach((vector, index) => {
          if (!vector) return;
          const values = Object.freeze([...vector]);
          const text = chunk[index];
          vectors.set(text, values);
          this.vectors.set(keyFor(text), { values, expiresAt: Date.now() + CACHE_TTL_MS });
          while (this.vectors.size > MAX_CACHE_ENTRIES) {
            const oldest = this.vectors.keys().next().value;
            if (oldest === undefined) break;
            this.vectors.delete(oldest);
          }
        });
      } catch (error) {
        this.config.signal?.throwIfAborted();
        if (error instanceof VertexTextEmbeddingError) throw error;
        throw new VertexTextEmbeddingError("Vertex AI embedContent failed", error);
      }
    }
    this.config.signal?.throwIfAborted();
    const ordered = texts.map(text => {
      const vector = vectors.get(text);
      if (!vector) throw new VertexTextEmbeddingError("Missing embedding vector");
      return vector;
    });
    if (ordered.some(vector => vector.length !== ordered[0].length)) {
      // A changed remote vector space must never mix cached and fresh dimensions.
      for (const text of texts) this.vectors.delete(keyFor(text));
      throw new VertexTextEmbeddingError("Inconsistent embedding vector dimensions");
    }
    return ordered;
  }
}
