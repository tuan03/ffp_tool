import { AppError } from "../../../shared/errors";
import type {
  ProductCrawlerCancelResponse,
  ProductCrawlerClient,
  ProductCrawlerCreateJobResponse,
  ProductCrawlerJobInput,
  ProductCrawlerJobOutput,
  ProductCrawlerJobStatus,
  ProductCrawlerJobStatusResponse,
} from "../types";
import { buildMockJobOutput, getFreshMockProducts } from "./data";

interface InMemoryJob {
  id: string;
  input: ProductCrawlerJobInput;
  status: ProductCrawlerJobStatus;
  pollCount: number;
  logs: string[];
  output?: ProductCrawlerJobOutput;
  createdAt: number;
}

export class MockProductCrawlerClient implements ProductCrawlerClient {
  private jobs = new Map<string, InMemoryJob>();

  public async startJob(input: ProductCrawlerJobInput): Promise<ProductCrawlerCreateJobResponse> {
    if (!input.inputs || input.inputs.length === 0) {
      throw new AppError("No valid ASIN or URL provided in input", "PRODUCT_CRAWLER_INVALID_INPUT");
    }

    const jobId = `crawl_job_${Date.now().toString(16).slice(-8)}`;
    const nowStr = new Date().toLocaleTimeString();

    const initialLogs = [
      `[${nowStr}] Initialized crawl job ${jobId} for ${input.inputs.length} inputs (mode: ${input.crawlMode})`,
      `[${nowStr}] Validating Amazon source identifiers...`,
    ];

    const job: InMemoryJob = {
      id: jobId,
      input,
      status: "queued",
      pollCount: 0,
      logs: initialLogs,
      createdAt: Date.now(),
    };

    this.jobs.set(jobId, job);

    return {
      ok: true,
      jobId,
      status: "queued",
    };
  }

  public async getJob(jobId: string): Promise<ProductCrawlerJobStatusResponse> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new AppError(`Job with ID ${jobId} not found`, "PRODUCT_CRAWLER_JOB_NOT_FOUND");
    }

    if (job.status === "cancelled") {
      return {
        ok: true,
        jobId: job.id,
        status: "cancelled",
        stepper: {
          currentStep: 0,
          percent: 0,
          currentMessage: "Job đã bị người dùng hủy bỏ.",
        },
        summary: {
          requestedInputs: job.input.inputs.length,
          productsFound: 0,
          productsCompleted: 0,
          productsFailed: 0,
        },
        logs: [...job.logs],
      };
    }

    if (job.status === "completed" || job.status === "partial") {
      return {
        ok: true,
        jobId: job.id,
        status: job.status,
        stepper: {
          currentStep: 5,
          percent: 100,
          currentMessage: "Đã hoàn thành cào dữ liệu toàn bộ sản phẩm!",
        },
        summary: {
          requestedInputs: job.input.inputs.length,
          productsFound: job.output?.products.length ?? 4,
          productsCompleted: job.output?.products.length ?? 4,
          productsFailed: job.output?.errors.length ?? 0,
        },
        logs: [...job.logs],
        output: job.output ? JSON.parse(JSON.stringify(job.output)) : undefined,
      };
    }

    // Advance simulated progress
    job.pollCount += 1;
    const nowStr = new Date().toLocaleTimeString();

    if (job.pollCount === 1) {
      job.status = "running";
      job.logs.push(`[${nowStr}] Input validated: ${job.input.inputs.length} valid Amazon items accepted.`);
      job.logs.push(`[${nowStr}] Fetching Amazon product metadata for ${job.input.inputs[0]?.value ?? "target"}...`);

      return {
        ok: true,
        jobId: job.id,
        status: "running",
        stepper: {
          currentStep: 2,
          percent: 30,
          currentMessage: "Đang kết nối Amazon và fetch dữ liệu sản phẩm gốc...",
        },
        summary: {
          requestedInputs: job.input.inputs.length,
          productsFound: 2,
          productsCompleted: 0,
          productsFailed: 0,
        },
        logs: [...job.logs],
      };
    }

    if (job.pollCount === 2) {
      job.logs.push(`[${nowStr}] Found product listing: title, brand and 4 high-res gallery images loaded.`);
      job.logs.push(`[${nowStr}] Crawling source variants and size/color dimension matrix...`);

      return {
        ok: true,
        jobId: job.id,
        status: "running",
        stepper: {
          currentStep: 3,
          percent: 60,
          currentMessage: "Đang thu thập các source variants và ma trận thuộc tính...",
        },
        summary: {
          requestedInputs: job.input.inputs.length,
          productsFound: 3,
          productsCompleted: 1,
          productsFailed: 0,
        },
        logs: [...job.logs],
      };
    }

    if (job.pollCount === 3) {
      job.logs.push(`[${nowStr}] Discovered Amazon Customization widget v2.`);
      job.logs.push(`[${nowStr}] Parsing custom text inputs, font groups, and surface engraving options...`);

      return {
        ok: true,
        jobId: job.id,
        status: "running",
        stepper: {
          currentStep: 4,
          percent: 85,
          currentMessage: "Đang bóc tách tùy biến customization và tính toán surcharge...",
        },
        summary: {
          requestedInputs: job.input.inputs.length,
          productsFound: 4,
          productsCompleted: 3,
          productsFailed: 0,
        },
        logs: [...job.logs],
      };
    }

    if (job.status === "failed") {
      return {
        ok: false,
        jobId: job.id,
        status: "failed",
        stepper: {
          currentStep: 2,
          percent: 0,
          currentMessage: "Quá trình cào dữ liệu gặp lỗi kết nối hoặc trang Amazon không khả dụng.",
        },
        summary: {
          requestedInputs: job.input.inputs.length,
          productsFound: 0,
          productsCompleted: 0,
          productsFailed: job.input.inputs.length,
        },
        logs: [...job.logs],
        error: "Amazon product page returned 404 or inactive listing",
      };
    }

    // Step 4+ -> Completed or Partial
    const products = getFreshMockProducts();
    const output = buildMockJobOutput(job.id, products, job.input.inputs.length);
    job.status = output.status;
    job.output = output;
    job.logs.push(`[${nowStr}] Successfully compiled ${products.length} products with ${output.statistics.finalVariants} variants.`);
    job.logs.push(`[${nowStr}] Crawl job finished. Ready for review and handoff.`);

    return {
      ok: true,
      jobId: job.id,
      status: job.status,
      stepper: {
        currentStep: 5,
        percent: 100,
        currentMessage: "Hoàn tất xử lý toàn bộ sản phẩm!",
      },
      summary: {
        requestedInputs: job.input.inputs.length,
        productsFound: products.length,
        productsCompleted: products.length,
        productsFailed: 0,
      },
      logs: [...job.logs],
      output: JSON.parse(JSON.stringify(output)),
    };
  }

  public async cancelJob(jobId: string): Promise<ProductCrawlerCancelResponse> {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "cancelled";
      const nowStr = new Date().toLocaleTimeString();
      job.logs.push(`[${nowStr}] User requested cancellation. Active operations aborted.`);
    }

    return {
      ok: true,
      status: "cancelled",
    };
  }

  public async retryJob(jobId: string, _itemIds?: string[]): Promise<ProductCrawlerCreateJobResponse> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      throw new AppError(`Job with ID ${jobId} not found`, "PRODUCT_CRAWLER_JOB_NOT_FOUND");
    }

    const newJobId = `crawl_job_retry_${Date.now().toString(16).slice(-8)}`;
    const nowStr = new Date().toLocaleTimeString();
    const retriedJob: InMemoryJob = {
      id: newJobId,
      input: existing.input,
      status: "queued",
      pollCount: 0,
      logs: [
        `[${nowStr}] Retrying crawl job for ${existing.input.inputs.length} inputs (previous job: ${jobId})`,
      ],
      createdAt: Date.now(),
    };
    this.jobs.set(newJobId, retriedJob);

    return {
      ok: true,
      jobId: newJobId,
      status: "queued",
    };
  }
}

export const mockProductCrawlerClient = new MockProductCrawlerClient();
