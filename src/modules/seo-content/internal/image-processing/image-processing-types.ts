import type { SeoContentImageInput, SeoContentImageOutput } from "../../types";

export interface ImageProcessingInput {
  readonly images: readonly SeoContentImageInput[];
  readonly sourceTitle?: string;
  readonly productTitle: string;
  readonly productHandle: string;
  readonly primaryKeyword?: string;
  readonly secondaryKeywords?: readonly string[];
  readonly productCategory?: string;
  readonly entities: readonly string[];
  readonly dominantColors?: readonly string[];
  readonly visualStyle?: string;
}

export type ImageProcessingIssueCode =
  | "source_unavailable"
  | "invalid_image"
  | "image_too_large"
  | "unsupported_format"
  | "converter_unavailable"
  | "conversion_failed"
  | "write_failed";

export interface ImageProcessingIssue {
  readonly imageIndex: number;
  readonly sourceUrl: string;
  readonly code: ImageProcessingIssueCode;
  readonly message?: string;
}

export interface ImageProcessingMetadata {
  readonly totalImages: number;
  readonly convertedImages: number;
  readonly failedConversions: number;
  readonly converter: "test" | "sharp" | "unavailable";
  readonly issues: readonly ImageProcessingIssue[];
}

export interface ImageArtifactLocation {
  readonly localFilePath?: string;
  readonly url?: string;
  readonly data?: Buffer;
}

export interface ImageSourceLoaded {
  readonly buffer: Buffer;
  readonly mimeType?: string;
}
