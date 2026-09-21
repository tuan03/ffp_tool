import { AppError } from "../../shared/errors";
import type {
  PinterestAuthStatus,
  PinterestDiscoveryInput,
  PinterestDiscoveryOutput,
  PinterestLaunchLoginPayload,
  PinterestLaunchLoginResponse,
  PinterestPodDeliverables,
  PinterestProductionInput,
  PinterestProductionOutput,
  PodBackendDeliverables,
  PodCandidate,
  PodComposedMockupSpec,
  PodDeliverableItem,
  PodJobStatusResponse,
  PodPollOptions,
  PodProductType,
} from "./types";
import { FACTORY_PRINT_STANDARDS } from "./types";

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_TIMEOUT_MS = 300_000;

function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    return "";
  }
  return process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8765";
}

async function requestJson<T>(
  endpoint: string,
  options: RequestInit = {},
  errorCode: string,
): Promise<T> {
  const url = `${getBaseUrl()}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new AppError(
        `Pinterest POD endpoint ${endpoint} failed with HTTP ${response.status}: ${errorText}`,
        errorCode,
      );
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(`Pinterest POD request to ${endpoint} failed`, errorCode, error);
  }
}

/** Check Pinterest persistent authentication status */
export async function getAuthStatus(): Promise<PinterestAuthStatus> {
  return requestJson<PinterestAuthStatus>(
    "/api/pinterest-pod/auth-status",
    { method: "GET" },
    "PINTEREST_POD_AUTH_FAILED",
  );
}

/** Launch Pinterest login browser window for persistent session creation */
export async function launchLogin(
  payload?: PinterestLaunchLoginPayload,
): Promise<PinterestLaunchLoginResponse> {
  return requestJson<PinterestLaunchLoginResponse>(
    "/api/pinterest-pod/launch-login",
    {
      method: "POST",
      body: JSON.stringify({ timeout: payload?.timeout ?? 600 }),
    },
    "PINTEREST_POD_LOGIN_FAILED",
  );
}

/** Submit Stage 1 discovery job */
export async function startDiscoveryJob(
  input: PinterestDiscoveryInput,
): Promise<{ ok: boolean; jobId: string; status: string; logs: readonly string[] }> {
  interface StartJobRawResponse {
    readonly ok: boolean;
    readonly jobId?: string;
    readonly job_id?: string;
    readonly status: string;
    readonly logs?: readonly string[];
  }

  const raw = await requestJson<StartJobRawResponse>(
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
    "PINTEREST_POD_DISCOVERY_FAILED",
  );

  const effectiveJobId = raw.jobId || raw.job_id || "";
  if (!effectiveJobId) {
    throw new AppError(
      "Backend response did not contain a valid jobId",
      "PINTEREST_POD_DISCOVERY_FAILED",
      raw,
    );
  }

  return {
    ok: raw.ok,
    jobId: effectiveJobId,
    status: raw.status,
    logs: raw.logs ?? [],
  };
}

/** Fetch status of any POD job by jobId */
export async function getJobStatus(jobId: string): Promise<PodJobStatusResponse> {
  const safeId = encodeURIComponent(jobId.trim());
  return requestJson<PodJobStatusResponse>(
    `/api/pinterest-pod/jobs/${safeId}`,
    { method: "GET" },
    "PINTEREST_POD_STATUS_FAILED",
  );
}

/** Cancel a running POD job */
export async function cancelJob(jobId: string): Promise<{ ok: boolean; message?: string }> {
  const safeId = encodeURIComponent(jobId.trim());
  return requestJson<{ ok: boolean; message?: string }>(
    `/api/pinterest-pod/jobs/${safeId}/cancel`,
    { method: "POST" },
    "PINTEREST_POD_CANCEL_FAILED",
  );
}

/** Poll job until target status or terminal failure */
async function pollJobUntil(
  jobId: string,
  acceptableStatuses: readonly string[],
  options?: PodPollOptions,
): Promise<PodJobStatusResponse> {
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const statusRes = await getJobStatus(jobId);
    options?.onProgress?.(statusRes);

    if (acceptableStatuses.includes(statusRes.status)) {
      return statusRes;
    }

    if (statusRes.status === "failed") {
      throw new AppError(
        statusRes.error || statusRes.message || `Job ${jobId} failed on Pinterest backend`,
        "PINTEREST_POD_JOB_FAILED",
        statusRes,
      );
    }

    if (statusRes.status === "cancelled") {
      throw new AppError(
        statusRes.message || `Job ${jobId} was cancelled`,
        "PINTEREST_POD_JOB_CANCELLED",
        statusRes,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new AppError(
    `Polling Pinterest POD job ${jobId} timed out after ${timeoutMs}ms`,
    "PINTEREST_POD_POLL_TIMEOUT",
  );
}

/** Poll Stage 1 job until candidates are ready for review */
export async function pollDiscoveryJob(
  jobId: string,
  options?: PodPollOptions,
): Promise<PinterestDiscoveryOutput> {
  const jobStatus = await pollJobUntil(jobId, ["ready_for_review", "completed"], options);

  const candidates: readonly PodCandidate[] = jobStatus.candidates ?? [];
  return {
    ok: jobStatus.ok,
    jobId: jobStatus.jobId || jobStatus.job_id || jobId,
    status: jobStatus.status,
    total_candidates: jobStatus.total_candidates ?? candidates.length,
    stepper: jobStatus.stepper ?? {
      current_step: 2,
      percent: 40,
      current_message: `Đã quét & chấm điểm (${candidates.length} ứng viên). Mời bạn duyệt mẫu.`,
    },
    logs: jobStatus.logs ?? [],
    candidates,
  };
}

/** Orchestrate Stage 1 discovery: submit job and poll until candidates are ready */
export async function runDiscovery(
  input: PinterestDiscoveryInput,
  options?: PodPollOptions,
): Promise<PinterestDiscoveryOutput> {
  const job = await startDiscoveryJob(input);
  return pollDiscoveryJob(job.jobId, options);
}

/** Submit Stage 2 production order for selected candidates */
export async function startProductionJob(
  input: PinterestProductionInput,
): Promise<{ ok: boolean; status: string }> {
  return requestJson<{ ok: boolean; status: string }>(
    "/api/pinterest-pod/jobs/produce",
    {
      method: "POST",
      body: JSON.stringify({
        jobId: input.jobId,
        selected_candidates: input.selected_candidates,
      }),
    },
    "PINTEREST_POD_PRODUCTION_FAILED",
  );
}

/** Build structured SEO deliverables package conforming to CONTRACT_PINTEREST_POD_TO_SEO */
export function buildSeoDeliverables(
  jobStatus: PodJobStatusResponse,
  productType: PodProductType = "rug",
): PinterestPodDeliverables {
  const deliverables: PodBackendDeliverables = jobStatus.deliverables ?? {};
  const comparisonRows = deliverables.comparison_rows ?? deliverables.comparison_matrix ?? [];
  const printStandard = FACTORY_PRINT_STANDARDS[productType];
  const workflowId = jobStatus.jobId || jobStatus.job_id || "pod_production_completed";
  const candidatesMap = new Map<string, PodCandidate>();

  if (jobStatus.candidates) {
    for (const cand of jobStatus.candidates) {
      candidatesMap.set(cand.id, cand);
      if (cand.image_url) {
        candidatesMap.set(cand.image_url, cand);
      }
    }
  }

  let items: PodDeliverableItem[] = [];

  if (comparisonRows.length > 0) {
    items = comparisonRows.map((row, idx) => {
      const designId = `design_${productType}_${row.index || idx + 1}`;
      const matchedCand =
        candidatesMap.get(row.source_url) ||
        (jobStatus.candidates && jobStatus.candidates[idx]) ||
        undefined;

      const sourceCandidateId = matchedCand?.id ?? `cand_pin_${101 + idx}`;
      const originalPinTitle = matchedCand?.title ?? row.product_label;
      const trendKeywords = matchedCand?.trend
        ? [matchedCand.trend, matchedCand.query ?? "", `${productType} aesthetic`].filter(Boolean)
        : [`${productType} aesthetic`, "vintage trend", "lifestyle home"];

      const composedMockups: PodComposedMockupSpec[] = row.ai_background_urls.map(
        (bgUrl, bgIdx) => {
          const matchedMockup = deliverables.lifestyle_mockups?.find((m) => m.url === bgUrl);
          const isLiving = bgIdx % 2 === 0;
          return {
            referenceImageId: `ref_room_0${bgIdx + 1}`,
            mockupUrl: bgUrl,
            detectedSceneType:
              matchedMockup?.scene_type ?? (isLiving ? "living_room" : "bedroom"),
            detectedSceneDescription:
              matchedMockup?.scene_description ??
              (isLiving
                ? "Modern spacious living room with natural sunlight and couch"
                : "Cozy minimalist bedroom with hardwood flooring and bedding"),
          };
        },
      );

      return {
        designId,
        sourceCandidateId,
        productType,
        originalPinTitle,
        trendKeywords,
        printMaster: {
          cmykUrl: row.final_print_url,
          rgbUrl: row.final_print_url.replace("_cmyk_300dpi.jpg", "_rgb_4k.png"),
          widthPx: printStandard.widthPx,
          heightPx: printStandard.heightPx,
          dpi: 300,
          colorMode: "CMYK",
          label: printStandard.label,
          badge: printStandard.badge,
        },
        cutoutProduct: {
          transparentUrl: row.cutout_url,
          whiteBgUrl: row.cutout_white_url,
        },
        composedMockups,
      };
    });
  } else if (deliverables.print_cmyk_images && deliverables.print_cmyk_images.length > 0) {
    items = deliverables.print_cmyk_images.map((cmykImg, idx) => {
      const designId = `design_${productType}_${idx + 1}`;
      const matchedCand = jobStatus.candidates ? jobStatus.candidates[idx] : undefined;
      const sourceCandidateId = matchedCand?.id ?? `cand_pin_${101 + idx}`;
      const originalPinTitle = matchedCand?.title ?? `Design #${idx + 1}`;
      const rgbImg = deliverables.final_png_images ? deliverables.final_png_images[idx] : undefined;
      const whiteCutout = deliverables.product_cutouts_white
        ? deliverables.product_cutouts_white[idx]
        : undefined;
      const transCutout = deliverables.product_cutouts
        ? deliverables.product_cutouts[idx]
        : undefined;

      const mockups: PodComposedMockupSpec[] = (deliverables.lifestyle_mockups ?? []).map(
        (m, mIdx) => ({
          referenceImageId: `ref_room_0${mIdx + 1}`,
          mockupUrl: m.url,
          detectedSceneType: m.scene_type ?? (mIdx % 2 === 0 ? "living_room" : "bedroom"),
          detectedSceneDescription:
            m.scene_description ??
            (mIdx % 2 === 0
              ? "Modern spacious living room with couch and natural lighting"
              : "Cozy bedroom with wooden floor"),
        }),
      );

      return {
        designId,
        sourceCandidateId,
        productType,
        originalPinTitle,
        trendKeywords: matchedCand?.trend
          ? [matchedCand.trend, matchedCand.query ?? ""].filter(Boolean)
          : [`${productType} trend`, "home decor"],
        printMaster: {
          cmykUrl: cmykImg.url,
          rgbUrl: rgbImg?.url ?? cmykImg.url.replace("_cmyk_300dpi.jpg", "_rgb_4k.png"),
          widthPx: printStandard.widthPx,
          heightPx: printStandard.heightPx,
          dpi: 300,
          colorMode: "CMYK",
          label: printStandard.label,
          badge: printStandard.badge,
        },
        cutoutProduct: {
          transparentUrl: transCutout?.url ?? "",
          whiteBgUrl: whiteCutout?.url ?? "",
        },
        composedMockups: mockups,
      };
    });
  }

  return {
    workflowId,
    success: true,
    productType,
    totalProduced: items.length,
    items,
  };
}

/** Poll Stage 2 production until completed */
export async function pollProductionJob(
  jobId: string,
  productType: PodProductType = "rug",
  options?: PodPollOptions,
): Promise<PinterestProductionOutput> {
  const jobStatus = await pollJobUntil(jobId, ["completed"], options);
  const deliverables = jobStatus.deliverables ?? {};
  const metrics = jobStatus.summaryMetrics ??
    jobStatus.summary_metrics ?? {
      rgb_4k_count: deliverables.final_png_images?.length ?? 0,
      cmyk_count: deliverables.print_cmyk_images?.length ?? 0,
      lifestyle_mockup_count: deliverables.lifestyle_mockups?.length ?? 0,
      cutouts_count: deliverables.product_cutouts_white?.length ?? 0,
      mockups_count: deliverables.lifestyle_mockups?.length ?? 0,
    };

  const seoDeliverables = buildSeoDeliverables(jobStatus, productType);

  return {
    ok: jobStatus.ok,
    jobId: jobStatus.jobId || jobStatus.job_id || jobId,
    status: jobStatus.status,
    stepper: jobStatus.stepper ?? {
      current_step: 4,
      percent: 100,
      current_message: "Hoàn thành! Đã tạo đầy đủ mockup AI & file in CMYK xưởng.",
    },
    logs: jobStatus.logs ?? [],
    summaryMetrics: metrics,
    deliverables,
    seoDeliverables,
  };
}

/** Orchestrate Stage 2 production: trigger produce and poll until completed */
export async function runProduction(
  input: PinterestProductionInput,
  options?: PodPollOptions,
): Promise<PinterestProductionOutput> {
  await startProductionJob(input);
  return pollProductionJob(input.jobId, input.product ?? "rug", options);
}
