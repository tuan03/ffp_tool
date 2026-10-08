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

/** Operational batch request. Product generation input is SeoContentInput in the SEO Content module. */
export interface GatewaySeoContentRequest {
  readonly workflowId: string;
  readonly storeId: string;
  readonly shopDomain: string;
  readonly products: readonly AutoSeoProductPayload[];
}

export interface SeoContentResult {
  readonly provider?: "gemini" | "custom_gpt" | "codex_mcp";
  readonly success: boolean;
  readonly processedCount: number;
  readonly message?: string;
  readonly seoOutputs?: readonly unknown[];
  readonly dispatchStatus?: "queued" | "review_ready";
  readonly jobIds?: readonly string[];
}

import type { SeoContentInput as CoreSeoContentInput, SeoContentOutput, SeoStoreProfile } from "../../src/modules/seo-content";
import type { GptSeoSettings } from "../../src/modules/custom-gpt-seo";

export interface GatewaySeoContentOptions {
  readonly providerSettings?: GptSeoSettings;
  /** Server-resolved policy snapshot, never populated from the HTTP request. */
  readonly storeProfile?: SeoStoreProfile;
  readonly runner?: (input: CoreSeoContentInput) => Promise<SeoContentOutput>;
}

export type SeoContentRunner = (
  input: GatewaySeoContentRequest,
  options?: GatewaySeoContentOptions,
) => Promise<SeoContentResult>;
