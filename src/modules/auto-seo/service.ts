import { AppError } from "../../shared/errors/app-error";
import type {
  AutoSeoClient,
  AutoSeoContentInput,
  AutoSeoOutput,
  AutoSeoWorkflowInput,
  ShopifyProductForAutoSeoUi,
} from "./types";

export async function runAutoSeo(input: AutoSeoWorkflowInput): Promise<AutoSeoOutput> {
  const trimmedNiche = input.niche.trim();
  if (!trimmedNiche) {
    throw new AppError("Niche cannot be empty when running Auto SEO.", "AUTO_SEO_INVALID_INPUT");
  }

  if (!input.products || input.products.length === 0) {
    throw new AppError("No product candidates provided to Auto SEO.", "AUTO_SEO_INVALID_INPUT");
  }

  const selectedSet =
    input.selectedProductIds && input.selectedProductIds.length > 0
      ? new Set(input.selectedProductIds)
      : null;

  const targetCandidates = selectedSet
    ? input.products.filter((candidate) => selectedSet.has(candidate.productId))
    : input.products;

  const warnings: string[] = [];
  const seoContentInputs: AutoSeoContentInput[] = [];

  for (const candidate of targetCandidates) {
    if (!candidate.title || !candidate.title.trim()) {
      warnings.push(`Product ${candidate.productId} has empty title.`);
    }

    if (!candidate.handle || !candidate.handle.trim()) {
      warnings.push(`Product ${candidate.productId} has empty handle.`);
    }

    if (!candidate.images || candidate.images.length === 0) {
      warnings.push(`Product ${candidate.productId} has no images.`);
    }

    if (!candidate.descriptionHtml || !candidate.descriptionHtml.trim()) {
      warnings.push(`Product ${candidate.productId} has empty descriptionHtml.`);
    }

    seoContentInputs.push({
      productId: candidate.productId,
      handle: candidate.handle,
      niche: trimmedNiche,
      sourceTitle: candidate.title,
      sourceDescriptionHtml: candidate.descriptionHtml,
      images: candidate.images.map((img) => ({
        url: img.url,
        altText: img.altText,
        position: img.position,
      })),
    });
  }

  return {
    workflowId: input.workflowId || `auto_seo_${Date.now()}`,
    selectedCount: seoContentInputs.length,
    seoContentInputs,
    warnings,
  };
}

export class RealAutoSeoClient implements AutoSeoClient {
  public constructor(private readonly baseUrl = "") {}

  public async loadProducts(): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/shopify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "products.list",
        }),
      });

      if (!response.ok) {
        throw new AppError(
          `Failed to load Shopify products: HTTP ${response.status}`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }

      const payload = (await response.json()) as unknown;
      if (Array.isArray(payload)) {
        return payload as ShopifyProductForAutoSeoUi[];
      }

      if (
        payload &&
        typeof payload === "object" &&
        "products" in payload &&
        Array.isArray((payload as { products: unknown }).products)
      ) {
        return (payload as { products: ShopifyProductForAutoSeoUi[] }).products;
      }

      if (
        payload &&
        typeof payload === "object" &&
        "data" in payload &&
        typeof (payload as { data: unknown }).data === "object" &&
        (payload as { data: { products?: unknown } }).data?.products &&
        Array.isArray((payload as { data: { products: unknown[] } }).data.products)
      ) {
        return (payload as { data: { products: ShopifyProductForAutoSeoUi[] } }).data.products;
      }

      return [];
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Failed to load products from Shopify API.",
        "AUTO_SEO_LOAD_FAILED",
        error,
      );
    }
  }

  public async runAutoSeo(input: AutoSeoWorkflowInput): Promise<AutoSeoOutput> {
    try {
      return await runAutoSeo(input);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Auto SEO execution failed.",
        "AUTO_SEO_RUN_FAILED",
        error,
      );
    }
  }
}

export const realAutoSeoClient = new RealAutoSeoClient();
