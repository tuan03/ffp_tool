export interface AutoSeoProductPayload {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly description?: string;
  readonly descriptionHtml?: string;
  readonly status?: string;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly onlineStoreUrl?: string;
  readonly featuredImage?: unknown;
  readonly images?: readonly unknown[];
  readonly variants?: readonly unknown[];
  readonly seo?: unknown;
  readonly hasMoreVariants?: boolean;
  readonly hasMoreImages?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly [key: string]: unknown;
}

export interface SeoContentInput {
  readonly workflowId: string;
  readonly storeId: string;
  readonly shopDomain: string;
  readonly products: readonly AutoSeoProductPayload[];
}

export interface SeoContentResult {
  readonly success: boolean;
  readonly processedCount: number;
  readonly message?: string;
  readonly seoOutputs?: readonly unknown[];
}

import type { SeoContentInput as CoreSeoContentInput, SeoContentOutput } from "../../src/modules/seo-content";

export interface GatewaySeoContentOptions {
  readonly runner?: (input: CoreSeoContentInput) => Promise<SeoContentOutput>;
}

export type SeoContentRunner = (
  input: SeoContentInput,
  options?: GatewaySeoContentOptions,
) => Promise<SeoContentResult>;
