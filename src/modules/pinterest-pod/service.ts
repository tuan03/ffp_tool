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
  PodCancelJobResponse,
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

function getBaseUrl(customBaseUrl?: string): string {
  if (customBaseUrl !== undefined && customBaseUrl.trim().length > 0) {
    return customBaseUrl.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    return "";
  }
  const envUrl = typeof process !== "undefined" ? process.env?.VITE_BACKEND_URL : undefined;
  return envUrl ? envUrl.replace(/\/+$/, "") : "http://127.0.0.1:8765";
}

/** Build standard relative asset URL conforming to CONTRACT_MAIN_TO_PINTEREST_POD */
export function getAssetUrl(jobId: string, filename: string): string {
  const safeJobId = encodeURIComponent(jobId.trim());
  const safeFilename = encodeURIComponent(filename.trim());
  return `/api/pinterest-pod/assets/${safeJobId}/${safeFilename}`;
}

async function requestJson<T>(
  endpoint: string,
  options: RequestInit = {},
  errorCode: string,
  customBaseUrl?: string,
): Promise<T> {
  const url = `${getBaseUrl(customBaseUrl)}${endpoint}`;
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
export async function getAuthStatus(options?: {
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
}): Promise<PinterestAuthStatus> {
  return requestJson<PinterestAuthStatus>(
    "/api/pinterest-pod/auth-status",
    { method: "GET", signal: options?.signal },
    "PINTEREST_POD_AUTH_FAILED",
    options?.baseUrl,
  );
}

/** Launch Pinterest login browser window for persistent session creation */
export async function launchLogin(
  payload?: PinterestLaunchLoginPayload,
  options?: { readonly baseUrl?: string; readonly signal?: AbortSignal },
): Promise<PinterestLaunchLoginResponse> {
  interface RawLoginResponse {
    readonly ok: boolean;
    readonly message?: string;
    readonly status_text?: string;
    readonly status?: string;
    readonly logged_in?: boolean;
    readonly pid?: number;
    readonly error?: string;
  }

  const raw = await requestJson<RawLoginResponse>(
    "/api/pinterest-pod/launch-login",
    {
      method: "POST",
      body: JSON.stringify({ timeout: payload?.timeout ?? 600 }),
      signal: options?.signal,
    },
    "PINTEREST_POD_LOGIN_FAILED",
    options?.baseUrl,
  );

  return {
    ok: raw.ok,
    status_text: raw.status_text ?? raw.message ?? "Đã mở trình duyệt đăng nhập Pinterest",
    message: raw.message ?? raw.status_text,
    status: raw.status,
    logged_in: raw.logged_in,
    pid: raw.pid,
    error: raw.error,
  };
}

/** Submit Stage 1 discovery job */
export async function startDiscoveryJob(
  input: PinterestDiscoveryInput,
  options?: { readonly baseUrl?: string; readonly signal?: AbortSignal },
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
      signal: options?.signal,
    },
    "PINTEREST_POD_DISCOVERY_FAILED",
    options?.baseUrl,
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
export async function getJobStatus(
  jobId: string,
  options?: { readonly baseUrl?: string; readonly signal?: AbortSignal },
): Promise<PodJobStatusResponse> {
  const safeId = encodeURIComponent(jobId.trim());
  return requestJson<PodJobStatusResponse>(
    `/api/pinterest-pod/jobs/${safeId}`,
    { method: "GET", signal: options?.signal },
    "PINTEREST_POD_STATUS_FAILED",
    options?.baseUrl,
  );
}

/** Cancel a running POD job */
export async function cancelJob(
  jobId: string,
  options?: { readonly baseUrl?: string; readonly signal?: AbortSignal },
): Promise<PodCancelJobResponse> {
  const safeId = encodeURIComponent(jobId.trim());
  return requestJson<PodCancelJobResponse>(
    `/api/pinterest-pod/jobs/${safeId}/cancel`,
    { method: "POST", signal: options?.signal },
    "PINTEREST_POD_CANCEL_FAILED",
    options?.baseUrl,
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
    if (options?.signal?.aborted) {
      throw new AppError("Polling Pinterest POD job was aborted", "PINTEREST_POD_JOB_ABORTED");
    }

    const statusRes = await getJobStatus(jobId, options);
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

    if (options?.signal?.aborted) {
      throw new AppError("Polling Pinterest POD job was aborted", "PINTEREST_POD_JOB_ABORTED");
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (options?.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }
        resolve();
      }, intervalMs);

      function onAbort() {
        clearTimeout(timer);
        reject(new AppError("Polling Pinterest POD job was aborted", "PINTEREST_POD_JOB_ABORTED"));
      }

      if (options?.signal) {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
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
  const job = await startDiscoveryJob(input, options);
  return pollDiscoveryJob(job.jobId, options);
}

/** Submit Stage 2 production order for selected candidates */
export async function startProductionJob(
  input: PinterestProductionInput,
  options?: { readonly baseUrl?: string; readonly signal?: AbortSignal },
): Promise<{ ok: boolean; jobId: string; status: string }> {
  interface ProduceRawResponse {
    readonly ok: boolean;
    readonly jobId?: string;
    readonly job_id?: string;
    readonly status: string;
  }

  const raw = await requestJson<ProduceRawResponse>(
    "/api/pinterest-pod/jobs/produce",
    {
      method: "POST",
      body: JSON.stringify({
        jobId: input.jobId,
        selected_candidates: input.selected_candidates,
        ...(input.product ? { product: input.product } : {}),
        ...(input.niche ? { niche: input.niche } : {}),
      }),
      signal: options?.signal,
    },
    "PINTEREST_POD_PRODUCTION_FAILED",
    options?.baseUrl,
  );

  const effectiveJobId = raw.jobId || raw.job_id || input.jobId;

  return {
    ok: raw.ok,
    jobId: effectiveJobId,
    status: raw.status,
  };
}

/** Helper to extract filename from URL or path */
function extractFilename(urlOrPath?: string): string | undefined {
  if (!urlOrPath) return undefined;
  const parts = urlOrPath.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last && last.trim().length > 0 ? last : undefined;
}

/** Build structured SEO deliverables package conforming to CONTRACT_PINTEREST_POD_TO_SEO */
export function buildSeoDeliverables(
  jobStatus: PodJobStatusResponse,
  productType: PodProductType = "rug",
  selectedCandidateIds?: readonly string[],
): PinterestPodDeliverables {
  const deliverables: PodBackendDeliverables = jobStatus.deliverables ?? {};
  const comparisonRows = deliverables.comparison_rows ?? deliverables.comparison_matrix ?? [];
  const printStandard = FACTORY_PRINT_STANDARDS[productType];
  const workflowId = jobStatus.jobId || jobStatus.job_id || "pod_production_completed";

  // Build multi-index candidate maps for robust lookup
  const candidatesById = new Map<string, PodCandidate>();
  const candidatesByFilename = new Map<string, PodCandidate>();
  const candidatesByUrl = new Map<string, PodCandidate>();

  if (jobStatus.candidates) {
    for (const cand of jobStatus.candidates) {
      if (cand.id) candidatesById.set(cand.id, cand);
      if (cand.image_id) candidatesById.set(cand.image_id, cand);
      if (cand.pin_id) candidatesById.set(cand.pin_id, cand);
      if (cand.image_url) {
        candidatesByUrl.set(cand.image_url, cand);
        const fname = extractFilename(cand.image_url);
        if (fname) candidatesByFilename.set(fname, cand);
      }
      if (cand.thumbnail_url) {
        candidatesByUrl.set(cand.thumbnail_url, cand);
        const fname = extractFilename(cand.thumbnail_url);
        if (fname) candidatesByFilename.set(fname, cand);
      }
      if (cand.local_filename) {
        candidatesByFilename.set(cand.local_filename, cand);
      }
    }
  }

  const effectiveSelectedIds: readonly string[] =
    selectedCandidateIds ?? jobStatus.selected_candidates ?? [];

  let items: PodDeliverableItem[] = [];

  if (comparisonRows.length > 0) {
    items = comparisonRows.map((row, idx) => {
      const designId = `design_${productType}_${row.index || idx + 1}`;

      // 1. Try selected candidate ID at the matching position
      const selectedId = effectiveSelectedIds[idx];
      let matchedCand: PodCandidate | undefined = selectedId
        ? candidatesById.get(selectedId)
        : undefined;

      // 2. Try source_url direct match
      if (!matchedCand && row.source_url) {
        matchedCand = candidatesByUrl.get(row.source_url);
      }

      // 3. Try filename of source_url
      if (!matchedCand && row.source_url) {
        const sourceFname = extractFilename(row.source_url);
        if (sourceFname) {
          matchedCand = candidatesByFilename.get(sourceFname);
        }
      }

      // 4. Try candidate ID/Pin substring matching
      if (!matchedCand && jobStatus.candidates && row.source_url) {
        matchedCand = jobStatus.candidates.find(
          (c) =>
            (c.id && row.source_url.includes(c.id)) ||
            (c.pin_id && row.source_url.includes(c.pin_id)) ||
            (c.image_id && row.source_url.includes(c.image_id)),
        );
      }

      // 5. Fallback only if no candidate selection was provided
      if (!matchedCand && effectiveSelectedIds.length === 0 && jobStatus.candidates) {
        matchedCand = jobStatus.candidates[idx];
      }

      const sourceCandidateId = matchedCand?.id ?? selectedId ?? `cand_pin_${101 + idx}`;
      const originalPinTitle = matchedCand?.title ?? row.product_label;
      const trendKeywords = matchedCand?.trend
        ? [matchedCand.trend, matchedCand.query ?? "", `${productType} aesthetic`].filter(Boolean)
        : [`${productType} aesthetic`, "vintage trend", "lifestyle home"];

      const cmykUrl = row.final_print_url || "";
      const rgbFromFinalPng = deliverables.final_png_images?.[idx]?.url;
      const rgbFallback = cmykUrl
        .replace(/_cmyk_300dpi\.(jpe?g|png)$/i, "_rgb_4k.png")
        .replace(/_cmyk\.(jpe?g|png)$/i, "_rgb_4k.png");
      const rgbUrl = rgbFromFinalPng || (rgbFallback !== cmykUrl ? rgbFallback : `${cmykUrl}_rgb_4k.png`);

      const cmykFilename = extractFilename(cmykUrl) ?? `design_${row.index || idx + 1}_cmyk_300dpi.jpg`;
      const whiteCutoutFilename = extractFilename(row.cutout_white_url);
      const transCutoutFilename = extractFilename(row.cutout_url);

      const printMasterLocal = `temp/pinterest_pod/${workflowId}/${cmykFilename}`;
      const cutoutLocal = whiteCutoutFilename
        ? `temp/pinterest_pod/${workflowId}/${whiteCutoutFilename}`
        : transCutoutFilename
          ? `temp/pinterest_pod/${workflowId}/${transCutoutFilename}`
          : undefined;

      const backgroundUrls = row.ai_background_urls ?? [];
      const composedMockups: PodComposedMockupSpec[] = backgroundUrls.map(
        (bgUrl, bgIdx) => {
          const matchedMockup = deliverables.lifestyle_mockups?.find((m) => m.url === bgUrl);
          const isLiving = bgIdx % 2 === 0;
          const bgFilename = extractFilename(bgUrl);
          const mockupLocal = bgFilename ? `temp/pinterest_pod/${workflowId}/${bgFilename}` : undefined;

          return {
            referenceImageId: `ref_room_0${bgIdx + 1}`,
            mockupUrl: bgUrl,
            localFilePath: mockupLocal,
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
          cmykUrl,
          rgbUrl,
          localFilePath: printMasterLocal,
          widthPx: printStandard.widthPx,
          heightPx: printStandard.heightPx,
          dpi: 300,
          colorMode: "CMYK",
          label: printStandard.label,
          badge: printStandard.badge,
        },
        cutoutProduct: {
          transparentUrl: row.cutout_url || "",
          whiteBgUrl: row.cutout_white_url || "",
          localFilePath: cutoutLocal,
        },
        composedMockups,
      };
    });
  } else if (deliverables.print_cmyk_images && deliverables.print_cmyk_images.length > 0) {
    items = deliverables.print_cmyk_images.map((cmykImg, idx) => {
      const designId = `design_${productType}_${idx + 1}`;
      const selectedId = effectiveSelectedIds[idx];
      const matchedCand = selectedId
        ? candidatesById.get(selectedId)
        : jobStatus.candidates ? jobStatus.candidates[idx] : undefined;

      const sourceCandidateId = matchedCand?.id ?? selectedId ?? `cand_pin_${101 + idx}`;
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
          localFilePath: m.filename ? `temp/pinterest_pod/${workflowId}/${m.filename}` : undefined,
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
          localFilePath: cmykImg.filename ? `temp/pinterest_pod/${workflowId}/${cmykImg.filename}` : undefined,
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
          localFilePath: whiteCutout?.filename ? `temp/pinterest_pod/${workflowId}/${whiteCutout.filename}` : undefined,
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
  selectedCandidates?: readonly string[],
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

  const seoDeliverables = buildSeoDeliverables(jobStatus, productType, selectedCandidates);

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
  const prodJob = await startProductionJob(input, options);
  const targetJobId = prodJob.jobId || input.jobId;
  return pollProductionJob(targetJobId, input.product ?? "rug", options, input.selected_candidates);
}
