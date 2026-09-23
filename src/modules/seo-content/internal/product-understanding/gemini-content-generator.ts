import { GoogleGenAI } from "@google/genai";
import type { GeminiImagePart } from "./product-image-payload";
import { GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA } from "./gemini-analysis-schema";

export interface GeminiAnalysisRequest {
  readonly prompt: string;
  readonly imagePayload: GeminiImagePart;
  readonly systemInstruction: string;
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export interface GeminiStructuredTextRequest {
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly responseJsonSchema: Record<string, unknown>;
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  readonly temperature?: number;
  /** Set to zero for short deterministic classifications that do not need model reasoning tokens. */
  readonly thinkingBudget?: number;
}

export interface GeminiAnalysisResponse {
  readonly rawText: string;
}

export interface GeminiContentGenerator {
  generateProductImageAnalysis(
    request: GeminiAnalysisRequest,
  ): Promise<GeminiAnalysisResponse>;
  generateStructuredText?(
    request: GeminiStructuredTextRequest,
  ): Promise<GeminiAnalysisResponse>;
}

export class GeminiGeneratorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly isRetryable: boolean = false,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GeminiGeneratorError";
  }
}

/**
 * Fake implementation of GeminiContentGenerator for unit tests.
 * Completely deterministic, zero network, records call history.
 */
export class FakeGeminiContentGenerator implements GeminiContentGenerator {
  public readonly calls: GeminiAnalysisRequest[] = [];
  public readonly textCalls: GeminiStructuredTextRequest[] = [];
  private handler: (request: GeminiAnalysisRequest) => Promise<GeminiAnalysisResponse>;
  private textHandler?: (
    request: GeminiStructuredTextRequest,
  ) => Promise<GeminiAnalysisResponse>;

  constructor(
    initialHandler?:
      | ((request: GeminiAnalysisRequest) => Promise<GeminiAnalysisResponse> | GeminiAnalysisResponse)
      | GeminiAnalysisResponse
      | string,
  ) {
    if (typeof initialHandler === "function") {
      this.handler = async (req) => initialHandler(req);
    } else if (typeof initialHandler === "string") {
      this.handler = async () => ({ rawText: initialHandler });
    } else if (initialHandler && typeof initialHandler === "object") {
      this.handler = async () => initialHandler;
    } else {
      this.handler = async () => ({
        rawText: JSON.stringify({
          ocrTexts: [],
          detectedEntities: [],
          dominantColors: [],
          visualStyle: "unspecified",
          productCategory: "unknown",
        }),
      });
    }
  }

  setHandler(
    handler: (request: GeminiAnalysisRequest) => Promise<GeminiAnalysisResponse> | GeminiAnalysisResponse,
  ): void {
    this.handler = async (req) => handler(req);
  }

  setTextHandler(
    handler: (request: GeminiStructuredTextRequest) => Promise<GeminiAnalysisResponse> | GeminiAnalysisResponse,
  ): void {
    this.textHandler = async (req) => handler(req);
  }

  async generateProductImageAnalysis(
    request: GeminiAnalysisRequest,
  ): Promise<GeminiAnalysisResponse> {
    this.calls.push(request);
    return this.handler(request);
  }

  async generateStructuredText(
    request: GeminiStructuredTextRequest,
  ): Promise<GeminiAnalysisResponse> {
    this.textCalls.push(request);
    if (this.textHandler) {
      return this.textHandler(request);
    }
    return {
      rawText: JSON.stringify({
        targetAudience: ["general shoppers"],
        suitableOccasions: ["everyday use"],
        useCases: ["personal use"],
        buyerIntentKeywords: ["product", "casual product", "everyday product"],
      }),
    };
  }
}

export interface GoogleGenAIVertexGeneratorConfig {
  readonly projectId: string;
  readonly location?: string;
  readonly defaultModel?: string;
  readonly timeoutMs?: number;
  /**
   * Optional injected client adapter for unit testing without live Google ADC credentials.
   */
  readonly client?: {
    models: {
      generateContent(params: {
        model: string;
        contents: Array<{
          role: string;
          parts: Array<Record<string, unknown>>;
        }>;
        config: Record<string, unknown>;
      }): Promise<{ text?: string | null }>;
    };
  };
}

/**
 * Production Vertex AI Gemini Content Generator using official @google/genai SDK.
 * Authenticates seamlessly via Application Default Credentials (ADC) in Google Cloud/Vertex environment.
 */
export class GoogleGenAIVertexContentGenerator implements GeminiContentGenerator {
  private readonly projectId: string;
  private readonly location: string;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;
  private readonly client: {
    models: {
      generateContent(params: {
        model: string;
        contents: Array<{
          role: string;
          parts: Array<Record<string, unknown>>;
        }>;
        config: Record<string, unknown>;
      }): Promise<{ text?: string | null }>;
    };
  };

  constructor(config: GoogleGenAIVertexGeneratorConfig) {
    if (!config.projectId) {
      throw new GeminiGeneratorError("Vertex AI requires a valid projectId");
    }
    this.projectId = config.projectId;
    this.location = config.location || "global";
    this.defaultModel = config.defaultModel || "gemini-2.5-flash";
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

  async generateProductImageAnalysis(
    request: GeminiAnalysisRequest,
  ): Promise<GeminiAnalysisResponse> {
    const model = request.model || this.defaultModel;
    const timeoutMs = request.timeoutMs || this.defaultTimeoutMs;

    const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];

    if (request.imagePayload.type === "inline") {
      parts.push({
        inlineData: {
          mimeType: request.imagePayload.inlineData.mimeType,
          data: request.imagePayload.inlineData.data,
        },
      });
    } else {
      parts.push({
        fileData: {
          mimeType: request.imagePayload.fileData.mimeType,
          fileUri: request.imagePayload.fileData.fileUri,
        },
      });
    }

    let timer: NodeJS.Timeout | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new GeminiGeneratorError(
              `Gemini request timed out after ${timeoutMs}ms`,
              408,
              true,
            ),
          );
        }, timeoutMs);
      });

      const responsePromise = this.client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        config: {
          systemInstruction: request.systemInstruction,
          responseMimeType: "application/json",
          responseSchema: GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA,
          temperature: 0,
          candidateCount: 1,
          maxOutputTokens: request.maxOutputTokens || 2048,
        },
      });

      const response = await Promise.race([responsePromise, timeoutPromise]);
      const rawText = response.text;

      if (!rawText) {
        throw new GeminiGeneratorError(
          "Gemini response contained no text in candidates",
        );
      }

      return { rawText };
    } catch (err) {
      if (err instanceof GeminiGeneratorError) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      const status =
        typeof (err as Record<string, unknown>)?.status === "number"
          ? ((err as Record<string, unknown>).status as number)
          : undefined;

      const isRetryable =
        status === 408 ||
        status === 429 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        errMsg.includes("429") ||
        errMsg.includes("503") ||
        errMsg.includes("504") ||
        errMsg.includes("RESOURCE_EXHAUSTED") ||
        errMsg.includes("UNAVAILABLE") ||
        errMsg.includes("DEADLINE_EXCEEDED") ||
        errMsg.includes("ECONNRESET") ||
        errMsg.includes("ETIMEDOUT");

      throw new GeminiGeneratorError(
        `Gemini generateContent failed: ${errMsg}`,
        status,
        isRetryable,
        err,
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async generateStructuredText(
    request: GeminiStructuredTextRequest,
  ): Promise<GeminiAnalysisResponse> {
    const model = request.model || this.defaultModel;
    const timeoutMs = request.timeoutMs || this.defaultTimeoutMs;

    let timer: NodeJS.Timeout | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new GeminiGeneratorError(
              `Gemini request timed out after ${timeoutMs}ms`,
              408,
              true,
            ),
          );
        }, timeoutMs);
      });

      const responsePromise = this.client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: request.prompt }],
          },
        ],
        config: {
          systemInstruction: request.systemInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: request.responseJsonSchema,
          temperature: request.temperature ?? 0,
          candidateCount: 1,
          maxOutputTokens: request.maxOutputTokens || 2048,
          ...(request.thinkingBudget === undefined
            ? {}
            : { thinkingConfig: { thinkingBudget: request.thinkingBudget } }),
        },
      });

      const response = await Promise.race([responsePromise, timeoutPromise]);
      const rawText = response.text;

      if (!rawText) {
        throw new GeminiGeneratorError(
          "Gemini response contained no text in candidates",
        );
      }

      return { rawText };
    } catch (err) {
      if (err instanceof GeminiGeneratorError) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      const status =
        typeof (err as Record<string, unknown>)?.status === "number"
          ? ((err as Record<string, unknown>).status as number)
          : undefined;

      const isRetryable =
        status === 408 ||
        status === 429 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        errMsg.includes("429") ||
        errMsg.includes("503") ||
        errMsg.includes("504") ||
        errMsg.includes("RESOURCE_EXHAUSTED") ||
        errMsg.includes("UNAVAILABLE") ||
        errMsg.includes("DEADLINE_EXCEEDED") ||
        errMsg.includes("ECONNRESET") ||
        errMsg.includes("ETIMEDOUT");

      throw new GeminiGeneratorError(
        `Gemini generateContent failed: ${errMsg}`,
        status,
        isRetryable,
        err,
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

/**
 * Backwards compatibility alias for GoogleGenAIVertexContentGenerator.
 */
export const VertexGeminiContentGenerator = GoogleGenAIVertexContentGenerator;
export type VertexGeminiGeneratorConfig = GoogleGenAIVertexGeneratorConfig;
