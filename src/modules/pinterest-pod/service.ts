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
  const rows = deliverables?.comparison_rows ?? [];

  const isRug = productType === "rug";
  const widthPx = isRug ? 4000 : 10000;
  const heightPx = isRug ? 6400 : 11000;

  let items: PodDeliverableItem[] = [];

  if (rows.length > 0) {
    items = rows.map((row, index) => {
      // Robust candidate lookup: try matching by source_url, pin_id, title, or index
      const matchedCandidate =
        candidates.find(
          (c) =>
            c.image_url === row.source_url ||
            c.pin_url === row.source_url ||
            (c.pin_id && row.source_url.includes(c.pin_id)) ||
            (c.title && row.product_label.toLowerCase().includes(c.title.toLowerCase())) ||
            (c.title && c.title.toLowerCase().includes(row.product_label.toLowerCase())),
        ) ??
        candidates[index] ?? {
          id: `cand_pin_${101 + index}`,
          title: row.product_label,
          trend: "vintage distressed rug",
          query: "vintage rug",
        };

      const cmyk = deliverables?.print_cmyk_images[index] ?? {
        filename: `design_${String(index + 1).padStart(2, "0")}_cmyk_300dpi.jpg`,
        url: row.final_print_url,
      };

      // Derive standard RGB PNG URL conforming to CONTRACT_PINTEREST_POD_TO_SEO.md (rgbUrl: .../design_101_rgb_4k.png)
      let rgbUrl: string;
      if (cmyk.url.includes("cmyk_300dpi.jpg")) {
        rgbUrl = cmyk.url.replace("cmyk_300dpi.jpg", "rgb_4k.png");
      } else if (cmyk.url.startsWith("data:")) {
        rgbUrl = cmyk.url.replace("B%E1%BA%A2N%20IN%20CMYK", "B%E1%BA%A2N%20IN%20RGB%204K");
      } else {
        rgbUrl = cmyk.url.replace(/\.jpe?g$/i, "_rgb_4k.png");
      }

      // Associate mockups: first check if row's ai_background_urls match specific lifestyle mockups
      const allLifestyle = deliverables?.lifestyle_mockups ?? [];
      let designMockups = allLifestyle.filter(
        (mock) => row.ai_background_urls && row.ai_background_urls.includes(mock.url),
      );

      // If no direct URL match, distribute evenly across comparison rows
      if (designMockups.length === 0 && allLifestyle.length > 0) {
        const mockupsPerRow = Math.max(1, Math.floor(allLifestyle.length / rows.length));
        const startIdx = index * mockupsPerRow;
        designMockups = allLifestyle.slice(startIdx, startIdx + mockupsPerRow);
      }

      const composedMockups = designMockups.map((mock, mIndex) => ({
        referenceImageId: `ref_${String(mIndex + 1).padStart(2, "0")}`,
        mockupUrl: mock.url,
        detectedSceneType: mock.scene_type,
        detectedSceneDescription: mock.scene_description,
      }));

      const trendKeywords: string[] = [
        matchedCandidate.trend,
        matchedCandidate.query ? `${matchedCandidate.query} trend` : `${productType} decor`,
        `${productType} aesthetic`,
        "trending home decor",
        "pod print master",
      ].filter((kw, i, arr): kw is string => Boolean(kw) && arr.indexOf(kw) === i);

      return {
        designId: `design_${productType}_${101 + index}`,
        sourceCandidateId: matchedCandidate.id,
        productType,
        originalPinTitle: matchedCandidate.title,
        trendKeywords,
        printMaster: {
          cmykUrl: cmyk.url,
          rgbUrl,
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
  } else if (deliverables?.print_cmyk_images && deliverables.print_cmyk_images.length > 0) {
    // Fallback if comparison_rows is missing but print images are present
    items = deliverables.print_cmyk_images.map((cmyk, index) => {
      const matchedCandidate = candidates[index] ?? {
        id: `cand_pin_${101 + index}`,
        title: `Design #${index + 1}`,
        trend: "vintage distressed rug",
      };

      const rgbUrl = cmyk.url.replace("cmyk_300dpi.jpg", "rgb_4k.png");

      return {
        designId: `design_${productType}_${101 + index}`,
        sourceCandidateId: matchedCandidate.id,
        productType,
        originalPinTitle: matchedCandidate.title,
        trendKeywords: [matchedCandidate.trend, `${productType} decor`, "trending aesthetic"],
        printMaster: {
          cmykUrl: cmyk.url,
          rgbUrl,
          widthPx,
          heightPx,
          dpi: 300,
        },
        cutoutProduct: {
          transparentUrl: deliverables.product_cutouts_white[index]?.url ?? "",
          whiteBgUrl: deliverables.product_cutouts_white[index]?.url ?? "",
        },
        composedMockups: [],
      };
    });
  }

  return {
    workflowId: jobDetail.jobId,
    success: true,
    productType,
    totalProduced: items.length,
    items,
  };
}
