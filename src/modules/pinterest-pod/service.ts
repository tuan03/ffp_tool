import { AppError } from "../../shared/errors";
import type {
  CancelJobOutput,
  CreateJobInput,
  CreateJobOutput,
  JobDetailResponse,
  PinterestAuthStatus,
  PinterestLaunchLoginOutput,
  PinterestPodClient,
  PinterestPodDeliverables,
  PinterestProductType,
  PodDeliverableItem,
  ProduceInput,
  ProduceOutput,
} from "./types";

async function fetchJson<T>(url: string, init?: RequestInit, errorCode = "PINTEREST_API_ERROR"): Promise<T> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errorJson = (await response.json()) as { error?: string; message?: string };
        if (errorJson.error || errorJson.message) {
          errorMessage = errorJson.error ?? errorJson.message ?? errorMessage;
        }
      } catch {
        // Fallback to HTTP status text
      }
      throw new AppError(`Yêu cầu tới ${url} thất bại: ${errorMessage}`, errorCode);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      `Không thể kết nối tới máy chủ Pinterest POD (${url}): ${error instanceof Error ? error.message : String(error)}`,
      errorCode,
      error,
    );
  }
}

export class RealPinterestPodClient implements PinterestPodClient {
  public async getAuthStatus(): Promise<PinterestAuthStatus> {
    return fetchJson<PinterestAuthStatus>("/api/pinterest-pod/auth-status", undefined, "PINTEREST_AUTH_CHECK_FAILED");
  }

  public async launchLogin(timeout = 600): Promise<PinterestLaunchLoginOutput> {
    return fetchJson<PinterestLaunchLoginOutput>(
      "/api/pinterest-pod/launch-login",
      {
        method: "POST",
        body: JSON.stringify({ timeout }),
      },
      "PINTEREST_LOGIN_LAUNCH_FAILED",
    );
  }

  public async createJob(input: CreateJobInput): Promise<CreateJobOutput> {
    return fetchJson<CreateJobOutput>(
      "/api/pinterest-pod/jobs",
      {
        method: "POST",
        body: JSON.stringify({
          niche: input.niche,
          product: input.product,
          workflow_stage: input.workflow_stage ?? "crawl_and_review",
          candidatePoolSize: input.candidatePoolSize ?? 15,
          referenceImages: input.referenceImages ?? [],
        }),
      },
      "PINTEREST_JOB_CREATION_FAILED",
    );
  }

  public async getJobDetail(jobId: string): Promise<JobDetailResponse> {
    return fetchJson<JobDetailResponse>(
      `/api/pinterest-pod/jobs/${encodeURIComponent(jobId)}`,
      undefined,
      "PINTEREST_JOB_FETCH_FAILED",
    );
  }

  public async produce(input: ProduceInput): Promise<ProduceOutput> {
    return fetchJson<ProduceOutput>(
      "/api/pinterest-pod/jobs/produce",
      {
        method: "POST",
        body: JSON.stringify({
          jobId: input.jobId,
          selected_candidates: input.selected_candidates,
        }),
      },
      "PINTEREST_PRODUCE_FAILED",
    );
  }

  public async cancelJob(jobId: string): Promise<CancelJobOutput> {
    return fetchJson<CancelJobOutput>(
      `/api/pinterest-pod/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: "POST",
      },
      "PINTEREST_JOB_CANCEL_FAILED",
    );
  }
}

export const realPinterestPodClient = new RealPinterestPodClient();

/**
 * Packs completed Pinterest POD deliverables into the exact format conforming to CONTRACT_PINTEREST_POD_TO_SEO.md
 */
export function packageDeliverablesForSeo(
  jobDetail: JobDetailResponse,
  productType: PinterestProductType = "rug",
): PinterestPodDeliverables {
  const deliverables = jobDetail.deliverables;
  const candidates = jobDetail.candidates ?? [];

  const items: PodDeliverableItem[] = (deliverables?.comparison_rows ?? []).map((row, index) => {
    const candidate = candidates[index] ?? {
      id: `cand_pin_${101 + index}`,
      title: row.product_label,
      trend: "vintage boho rug",
    };

    const cmyk = deliverables?.print_cmyk_images[index] ?? {
      filename: `design_${String(index + 1).padStart(2, "0")}_cmyk_300dpi.jpg`,
      url: row.final_print_url,
    };

    const isRug = productType === "rug";
    const widthPx = isRug ? 4000 : 10000;
    const heightPx = isRug ? 6400 : 11000;

    const composedMockups = (deliverables?.lifestyle_mockups ?? [])
      .filter((_, mIndex) => Math.floor(mIndex / 2) === index)
      .map((mock, mIndex) => ({
        referenceImageId: `ref_${String(mIndex + 1).padStart(2, "0")}`,
        mockupUrl: mock.url,
        detectedSceneType: mock.scene_type,
        detectedSceneDescription: mock.scene_description,
      }));

    return {
      designId: `design_${productType}_${101 + index}`,
      sourceCandidateId: candidate.id,
      productType,
      originalPinTitle: candidate.title,
      trendKeywords: [
        candidate.trend,
        `${productType} decor`,
        "trending aesthetic",
        "home makeover",
      ],
      printMaster: {
        cmykUrl: cmyk.url,
        rgbUrl: row.final_print_url,
        widthPx,
        heightPx,
        dpi: 300,
      },
      cutoutProduct: {
        transparentUrl: row.cutout_url ?? "",
        whiteBgUrl: row.cutout_white_url ?? "",
      },
      composedMockups,
    };
  });

  return {
    workflowId: jobDetail.jobId,
    success: true,
    productType,
    totalProduced: items.length,
    items,
  };
}
