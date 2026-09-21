import { AppError } from "../../shared/errors";
import type {
  CrawlerProduct,
  CrawlerProductListItem,
  ParsedInputRow,
  ProductCrawlerCancelResponse,
  ProductCrawlerClient,
  ProductCrawlerCreateJobResponse,
  ProductCrawlerJobInput,
  ProductCrawlerJobStatusResponse,
  SeoContentInput,
} from "./types";

const ASIN_REGEX = /^[A-Z0-9]{10}$/i;
const AMAZON_URL_REGEX = /amazon\.[a-z.]+(?:\/.*)?\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i;

export function parseInputLines(rawText: string): ParsedInputRow[] {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim());
  const seenValues = new Set<string>();
  const rows: ParsedInputRow[] = [];

  for (const line of lines) {
    if (!line) {
      continue;
    }

    const urlMatch = line.match(AMAZON_URL_REGEX);
    if (urlMatch && urlMatch[1]) {
      const extractedAsin = urlMatch[1].toUpperCase();
      if (seenValues.has(extractedAsin)) {
        rows.push({
          raw: line,
          type: "url",
          value: extractedAsin,
          isValid: false,
          error: "Trùng lặp với mục khác",
        });
      } else {
        seenValues.add(extractedAsin);
        rows.push({
          raw: line,
          type: "url",
          value: extractedAsin,
          isValid: true,
        });
      }
      continue;
    }

    if (ASIN_REGEX.test(line)) {
      const asin = line.toUpperCase();
      if (seenValues.has(asin)) {
        rows.push({
          raw: line,
          type: "asin",
          value: asin,
          isValid: false,
          error: "Trùng lặp với mục khác",
        });
      } else {
        seenValues.add(asin);
        rows.push({
          raw: line,
          type: "asin",
          value: asin,
          isValid: true,
        });
      }
      continue;
    }

    rows.push({
      raw: line,
      type: "invalid",
      value: line,
      isValid: false,
      error: "Không đúng định dạng ASIN (10 ký tự) hoặc link Amazon hợp lệ",
    });
  }

  return rows;
}

export function validateCrawlerInput(input: ProductCrawlerJobInput): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (input.source !== "amazon") {
    errors.push("Nguồn cào dữ liệu phải là amazon.");
  }

  if (!Array.isArray(input.inputs) || input.inputs.length === 0) {
    errors.push("Danh sách ASIN hoặc URL không được để trống.");
  } else {
    for (let i = 0; i < input.inputs.length; i++) {
      const item = input.inputs[i];
      if (!item || !item.value.trim()) {
        errors.push(`Mục thứ ${i + 1} có giá trị rỗng.`);
      }
    }
  }

  if (input.crawlMode !== "exact" && input.crawlMode !== "group") {
    errors.push("Chế độ cào phải là 'exact' hoặc 'group'.");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function crawlerProductToListItem(product: CrawlerProduct): CrawlerProductListItem {
  const firstImage = product.media.find((m) => m.kind === "image")?.url;
  const asin = product.productDetails?.ASIN || product.parentAsin || product.id.replace(/^prod_/, "");
  const warningCount = product.warnings?.length ?? 0;
  const hasCustomization = Boolean(product.customization && product.customization !== null);

  let status: CrawlerProductListItem["status"] = "success";
  if (warningCount > 0) {
    status = "partial";
  }

  return {
    id: product.id,
    title: product.title,
    thumbnailUrl: firstImage,
    asin,
    variantCount: product.variants.length,
    hasCustomization,
    warningCount,
    status,
  };
}

export function crawlerProductToSeoInput(product: CrawlerProduct): SeoContentInput {
  const images = product.media.filter((m) => m.kind === "image").map((m) => m.url);

  return {
    productId: product.id,
    title: product.title,
    description: product.description,
    images,
    sourceUrl: product.canonicalUrl,
    sourceContext: {
      bulletPoints: product.bulletPoints ? [...product.bulletPoints] : undefined,
      productDetails: product.productDetails ? { ...product.productDetails } : undefined,
      customization: product.customization ? JSON.parse(JSON.stringify(product.customization)) : null,
    },
  };
}

export class RealProductCrawlerClient implements ProductCrawlerClient {
  public constructor(private readonly baseUrl = "") {}

  public async startJob(input: ProductCrawlerJobInput): Promise<ProductCrawlerCreateJobResponse> {
    const validation = validateCrawlerInput(input);
    if (!validation.isValid) {
      throw new AppError(
        `Invalid crawl input: ${validation.errors.join("; ")}`,
        "PRODUCT_CRAWLER_INVALID_INPUT",
      );
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/product-crawler/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new AppError(
          `Failed to start crawl job: HTTP ${response.status} ${response.statusText}`,
          "PRODUCT_CRAWLER_API_ERROR",
        );
      }

      return (await response.json()) as ProductCrawlerCreateJobResponse;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Network error while starting crawl job: ${(error as Error).message}`,
        "PRODUCT_CRAWLER_NETWORK_ERROR",
        error,
      );
    }
  }

  public async getJob(jobId: string): Promise<ProductCrawlerJobStatusResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/product-crawler/jobs/${encodeURIComponent(jobId)}`, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new AppError(
          `Failed to get job status for ${jobId}: HTTP ${response.status}`,
          "PRODUCT_CRAWLER_API_ERROR",
        );
      }

      return (await response.json()) as ProductCrawlerJobStatusResponse;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Network error fetching job ${jobId}: ${(error as Error).message}`,
        "PRODUCT_CRAWLER_NETWORK_ERROR",
        error,
      );
    }
  }

  public async cancelJob(jobId: string): Promise<ProductCrawlerCancelResponse> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/product-crawler/jobs/${encodeURIComponent(jobId)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );

      if (!response.ok) {
        throw new AppError(
          `Failed to cancel job ${jobId}: HTTP ${response.status}`,
          "PRODUCT_CRAWLER_CANCEL_FAILED",
        );
      }

      return (await response.json()) as ProductCrawlerCancelResponse;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Network error while cancelling job ${jobId}: ${(error as Error).message}`,
        "PRODUCT_CRAWLER_CANCEL_FAILED",
        error,
      );
    }
  }
}

export const realProductCrawlerClient = new RealProductCrawlerClient();
