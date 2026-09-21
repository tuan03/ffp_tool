export interface SeoContentImageInput {
  readonly id?: string;
  readonly url: string;
  readonly alt?: string;
  readonly localFilePath?: string;
}

export interface SeoContentInput {
  readonly images: readonly SeoContentImageInput[];
  readonly niche: string;
  readonly title: string;
  readonly description: string;
  readonly handle: string;
}

export interface SeoContentWebpAsset {
  readonly filename: string;
  readonly localFilePath?: string;
  readonly url?: string;
  readonly data?: Buffer | Uint8Array | Blob;
}

export interface SeoContentImageOutput {
  readonly sourceUrl: string;
  readonly alt: string;
  readonly webp: SeoContentWebpAsset;
}

export interface SeoContentOutput {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly images: readonly SeoContentImageOutput[];
  readonly productHandle: string;
}
