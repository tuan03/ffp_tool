import { AppError } from "../../shared/errors";
import type {
  CancelJobOutput,
  CreateJobInput,
  CreateJobOutput,
  JobDetailResponse,
  JobStatus,
  PinterestAuthStatus,
  PinterestDiscoveryInput,
  PinterestDiscoveryOutput,
  PinterestLaunchLoginOutput,
  PinterestLaunchLoginPayload,
  PinterestLaunchLoginResponse,
  PinterestPodClient,
  PinterestPodDeliverables,
  PinterestProductionInput,
  PinterestProductionOutput,
  PodBackendDeliverables,
  PodCancelJobResponse,
  PodCandidate,
  PodComposedMockupSpec,
  PodDeliverableItem,
  PodFactoryPrintStandard,
  PodJobStatusResponse,
  PodPollOptions,
  PodPriceVariantItem,
  PodProductType,
  PodRecentRunItem,
  PodStatusResponse,
  ProduceInput,
  ProduceOutput,
  SavePinterestTokenPayload,
  SavePinterestTokenResponse,
  SeoHandoverResponse,
  ThemeCluster,
  TrendDiscoveryInput,
  TrendDiscoveryResult,
} from "./types";
import {
  DEFAULT_POD_PRICE_VARIANTS,
  FACTORY_PRINT_STANDARDS,
  inferProductTypeFromNiche,
} from "./types";

export { inferProductTypeFromNiche };

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_TIMEOUT_MS = 300_000;

function getBaseUrl(customBaseUrl?: string): string {
  if (customBaseUrl !== undefined && customBaseUrl.trim().length > 0) {
    return customBaseUrl.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    return "";
  }
  const envUrl = typeof process !== "undefined"
    ? (process.env?.VITE_PINTEREST_POD_API_URL || process.env?.VITE_BACKEND_URL)
    : undefined;
  return envUrl ? envUrl.replace(/\/+$/, "") : "http://127.0.0.1:8768";
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
      let errorMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errorJson = (await response.json()) as { error?: string; message?: string };
        if (errorJson.error || errorJson.message) {
          errorMessage = errorJson.error ?? errorJson.message ?? errorMessage;
        }
      } catch {
        const errorText = await response.text().catch(() => "");
        if (errorText) errorMessage = errorText;
      }
      throw new AppError(
        `Pinterest POD endpoint ${endpoint} failed with HTTP ${response.status}: ${errorMessage}`,
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

/** Save Pinterest OAuth token (manual access token or authorization code) */
export async function saveOAuthToken(
  payload: SavePinterestTokenPayload,
  options?: { readonly baseUrl?: string; readonly signal?: AbortSignal },
): Promise<SavePinterestTokenResponse> {
  return requestJson<SavePinterestTokenResponse>(
    "/api/pinterest-pod/oauth/save-token",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options?.signal,
    },
    "PINTEREST_POD_SAVE_TOKEN_FAILED",
    options?.baseUrl,
  );
}

/** Get Pinterest OAuth Authorize URL */
export async function getOAuthAuthorizeUrl(
  redirectUri?: string,
  options?: { readonly baseUrl?: string; readonly signal?: AbortSignal },
): Promise<{ readonly ok: boolean; readonly auth_url: string }> {
  const query = redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : "";
  return requestJson<{ readonly ok: boolean; readonly auth_url: string }>(
    `/api/pinterest-pod/oauth/authorize-url${query}`,
    { method: "GET", signal: options?.signal },
    "PINTEREST_POD_GET_AUTH_URL_FAILED",
    options?.baseUrl,
  );
}

/** Discover Pinterest Trends & AI Theme Clusters (Tier 1 & Tier 2) */
export async function discoverTrends(
  input: TrendDiscoveryInput,
  options?: { readonly baseUrl?: string; readonly signal?: AbortSignal },
): Promise<TrendDiscoveryResult> {
  return requestJson<TrendDiscoveryResult>(
    "/api/pinterest-pod/trends/discover",
    {
      method: "POST",
      body: JSON.stringify(input),
      signal: options?.signal,
    },
    "PINTEREST_POD_DISCOVER_TRENDS_FAILED",
    options?.baseUrl,
  );
}

/** Rescue a candidate that was categorized as rejected */
export async function rescueCandidate(
  jobId: string,
  candidateId: string,
  options?: { readonly baseUrl?: string; readonly signal?: AbortSignal },
): Promise<{ readonly ok: boolean; readonly candidate: PodCandidate }> {
  const safeJobId = encodeURIComponent(jobId.trim());
  return requestJson<{ readonly ok: boolean; readonly candidate: PodCandidate }>(
    `/api/pinterest-pod/jobs/${safeJobId}/rescue`,
    {
      method: "POST",
      body: JSON.stringify({ candidate_id: candidateId }),
      signal: options?.signal,
    },
    "PINTEREST_POD_RESCUE_CANDIDATE_FAILED",
    options?.baseUrl,
  );
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

  const product = input.product ?? inferProductTypeFromNiche(input.niche);
  const poolSize = input.candidatePoolSize ?? input.task5_max_downloads ?? input.top_images ?? 40;

  const raw = await requestJson<StartJobRawResponse>(
    "/api/pinterest-pod/jobs",
    {
      method: "POST",
      body: JSON.stringify({
        niche: input.niche,
        product,
        workflow_stage: input.workflow_stage ?? "crawl_and_review",
        ...(input.trend_type ? { trend_type: input.trend_type } : {}),
        ...(input.interest ? { interest: input.interest } : {}),
        ...(input.interests ? { interests: input.interests } : {}),
        ...(input.region ? { region: input.region } : {}),
        ...(input.selected_clusters ? { selected_clusters: input.selected_clusters } : {}),
        ...(input.custom_queries ? { custom_queries: input.custom_queries } : {}),
        candidatePoolSize: poolSize,
        task5_max_downloads: poolSize,
        top_images: poolSize,
        referenceImages: input.referenceImages ?? [],
        ...(input.ai_background_variants !== undefined ? { ai_background_variants: input.ai_background_variants } : {}),
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

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new AppError(
    `Polling Pinterest POD job ${jobId} timed out after ${timeoutMs}ms`,
    "PINTEREST_POD_POLL_TIMEOUT",
  );
}

/** Poll Stage 1 discovery until candidates are ready for review */
export async function pollDiscoveryJob(
  jobId: string,
  options?: PodPollOptions,
): Promise<PinterestDiscoveryOutput> {
  const jobStatus = await pollJobUntil(jobId, ["ready_for_review"], options);
  const candidates = jobStatus.candidates ?? [];

  return {
    ok: jobStatus.ok,
    jobId: jobStatus.jobId || jobStatus.job_id || jobId,
    status: jobStatus.status,
    total_candidates: jobStatus.total_candidates ?? candidates.length,
    stepper: jobStatus.stepper ?? {
      current_step: 2,
      percent: 40,
      current_message: `Đã quét & chấm điểm Vision AI (${candidates.length} ứng viên). Mời bạn duyệt mẫu để sản xuất.`,
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

  const product = input.product ?? (input.niche ? inferProductTypeFromNiche(input.niche) : undefined);

  const raw = await requestJson<ProduceRawResponse>(
    "/api/pinterest-pod/jobs/produce",
    {
      method: "POST",
      body: JSON.stringify({
        jobId: input.jobId,
        selected_candidates: input.selected_candidates,
        ...(product ? { product } : {}),
        ...(input.niche ? { niche: input.niche } : {}),
        ...(input.design_mode ? { design_mode: input.design_mode } : {}),
        ...(input.referenceImages ? { referenceImages: input.referenceImages } : {}),
        ...(input.room_template_urls ? { room_template_urls: input.room_template_urls } : {}),
        ...(input.ai_background_variants !== undefined ? { ai_background_variants: input.ai_background_variants } : {}),
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

function resolvePrintStandard(productType: string): PodFactoryPrintStandard {
  const norm = productType.toLowerCase();
  if (norm.includes("blanket") || norm.includes("quilt") || norm.includes("bedding") || norm.includes("comforter") || norm.includes("pillow")) {
    return FACTORY_PRINT_STANDARDS.blanket;
  }
  if (norm.includes("bag") || norm.includes("tote")) {
    return FACTORY_PRINT_STANDARDS.bag;
  }
  if (norm.includes("rug") || norm.includes("doormat") || norm.includes("carpet") || norm.includes("mat")) {
    return FACTORY_PRINT_STANDARDS.rug;
  }
  return FACTORY_PRINT_STANDARDS[productType as PodProductType] || FACTORY_PRINT_STANDARDS.custom;
}

export interface BuildSeoDeliverablesOptions {
  readonly storeId?: string;
  readonly vendor?: string;
  readonly collectionIds?: readonly string[];
  readonly productType?: string;
  readonly priceAddition?: number;
  readonly discountPercent?: number;
  readonly profileSlug?: "default" | "jeminise";
  readonly applyJeminisePreset?: boolean;
  readonly imageProfileSlug?: string;
  readonly variants?: readonly PodPriceVariantItem[];
}

/** Build structured SEO deliverables package conforming to CONTRACT_PINTEREST_POD_TO_SEO */
export function buildSeoDeliverables(
  jobStatus: PodJobStatusResponse,
  productType: PodProductType = "rug",
  selectedCandidateIds?: readonly string[],
  approvedMockupUrls?: ReadonlySet<string> | readonly string[],
  shopifyConfig?: BuildSeoDeliverablesOptions,
): PinterestPodDeliverables {
  const deliverables: PodBackendDeliverables = jobStatus.deliverables ?? {};
  const comparisonRows = deliverables.comparison_rows ?? deliverables.comparison_matrix ?? [];
  const chosenType = (shopifyConfig?.productType?.trim() || productType) as PodProductType;
  const printStandard = resolvePrintStandard(chosenType);
  const workflowId = jobStatus.jobId || jobStatus.job_id || "pod_production_completed";
  if (jobStatus.status === "failed" || jobStatus.status === "cancelled") {
    throw new AppError("Không thể bàn giao SEO khi sản xuất chưa đạt kiểm định.", "PINTEREST_POD_JOB_FAILED");
  }

  const approvedSet = approvedMockupUrls
    ? (approvedMockupUrls instanceof Set ? approvedMockupUrls : new Set(approvedMockupUrls))
    : null;

  const isMockupApproved = (url: string): boolean => {
    if (!approvedSet) return true;
    if (approvedSet.has(url)) return true;
    const fname = extractFilename(url);
    if (fname && approvedSet.has(fname)) return true;
    return false;
  };

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

  // Calculate final variant selling prices and compare-at prices from shopifyConfig
  const addition = shopifyConfig?.priceAddition ?? 0;
  const discount = shopifyConfig?.discountPercent ?? 0;
  const rawVariants: readonly PodPriceVariantItem[] =
    shopifyConfig?.variants && shopifyConfig.variants.length > 0
      ? shopifyConfig.variants
      : DEFAULT_POD_PRICE_VARIANTS;

  const calculatedVariants = rawVariants.map((v: PodPriceVariantItem) => {
    const base = typeof v.basePrice === "number" && !isNaN(v.basePrice) ? v.basePrice : 29.99;
    const selling = (base + addition).toFixed(2);
    const compareAt =
      discount > 0 && discount < 100
        ? (Number(selling) / (1 - discount / 100)).toFixed(2)
        : undefined;
    return {
      title: v.label,
      price: selling,
      compareAtPrice: compareAt,
      sku: v.sku,
      optionValues: [
        {
          optionName: v.optionName || "Size",
          name: v.label,
        },
      ],
    };
  });

  let items: PodDeliverableItem[] = [];

  if (comparisonRows.length > 0) {
    items = comparisonRows.map((row, idx) => {
      const typeSlug = chosenType.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const designId = `design_${typeSlug}_${row.index || idx + 1}`;

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
      const rgbUrl =
        rgbFromFinalPng ||
        (cmykUrl.includes("data:")
          ? cmykUrl.replace(/CMYK/g, "RGB")
          : rgbFallback !== cmykUrl
            ? rgbFallback
            : `${cmykUrl}_rgb_4k.png`);

      const cmykFilename = extractFilename(cmykUrl) ?? `design_${row.index || idx + 1}_cmyk_300dpi.jpg`;
      const whiteCutoutFilename = extractFilename(row.cutout_white_url);
      const transCutoutFilename = extractFilename(row.cutout_url);

      const printMasterLocal = `temp/pinterest_pod/${workflowId}/${cmykFilename}`;
      const cutoutLocal = whiteCutoutFilename
        ? `temp/pinterest_pod/${workflowId}/${whiteCutoutFilename}`
        : transCutoutFilename
          ? `temp/pinterest_pod/${workflowId}/${transCutoutFilename}`
          : undefined;

      const backgroundUrls = (row.ai_background_urls ?? []).filter(isMockupApproved);
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
        productType: chosenType,
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
        storeId: shopifyConfig?.storeId,
        vendor: shopifyConfig?.vendor,
        collectionIds: shopifyConfig?.collectionIds,
        priceAddition: shopifyConfig?.priceAddition,
        discountPercent: shopifyConfig?.discountPercent,
        profileSlug: shopifyConfig?.profileSlug,
        applyJeminisePreset: shopifyConfig?.applyJeminisePreset,
        imageProfileSlug: shopifyConfig?.imageProfileSlug,
        variants: calculatedVariants,
      };
    });
  } else if (deliverables.print_cmyk_images && deliverables.print_cmyk_images.length > 0) {
    items = deliverables.print_cmyk_images.map((cmykImg, idx) => {
      const typeSlug = chosenType.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const designId = `design_${typeSlug}_${idx + 1}`;
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

      const mockups: PodComposedMockupSpec[] = (deliverables.lifestyle_mockups ?? [])
        .filter((m) => isMockupApproved(m.url))
        .map(
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
        productType: chosenType,
        originalPinTitle,
        trendKeywords: matchedCand?.trend
          ? [matchedCand.trend, matchedCand.query ?? ""].filter(Boolean)
          : [`${chosenType} trend`, "home decor"],
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
        storeId: shopifyConfig?.storeId,
        vendor: shopifyConfig?.vendor,
        collectionIds: shopifyConfig?.collectionIds,
        priceAddition: shopifyConfig?.priceAddition,
        discountPercent: shopifyConfig?.discountPercent,
        profileSlug: shopifyConfig?.profileSlug,
        applyJeminisePreset: shopifyConfig?.applyJeminisePreset,
        imageProfileSlug: shopifyConfig?.imageProfileSlug,
        variants: calculatedVariants,
      };
    });
  }

  return {
    workflowId,
    success: true,
    productType: chosenType,
    totalProduced: items.length,
    items,
    storeId: shopifyConfig?.storeId,
    vendor: shopifyConfig?.vendor,
    collectionIds: shopifyConfig?.collectionIds,
    priceAddition: shopifyConfig?.priceAddition,
    discountPercent: shopifyConfig?.discountPercent,
    profileSlug: shopifyConfig?.profileSlug,
    applyJeminisePreset: shopifyConfig?.applyJeminisePreset,
    imageProfileSlug: shopifyConfig?.imageProfileSlug,
    variants: calculatedVariants,
  };
}

export const packageDeliverablesForSeo = buildSeoDeliverables;

/** Poll Stage 2 production until completed */
export async function pollProductionJob(
  jobId: string,
  productType: PodProductType = "rug",
  options?: PodPollOptions,
  selectedCandidates?: readonly string[],
): Promise<PinterestProductionOutput> {
  const jobStatus = await pollJobUntil(jobId, ["completed"], options);
  const deliverables: PodBackendDeliverables = jobStatus.deliverables ?? {};
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

async function fetchJson<T>(url: string, init?: RequestInit, errorCode = "PINTEREST_API_ERROR"): Promise<T> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
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

  public async saveOAuthToken(payload: SavePinterestTokenPayload): Promise<SavePinterestTokenResponse> {
    return saveOAuthToken(payload);
  }

  public async getOAuthAuthorizeUrl(redirectUri?: string): Promise<{ readonly ok: boolean; readonly auth_url: string }> {
    return getOAuthAuthorizeUrl(redirectUri);
  }

  public async discoverTrends(input: TrendDiscoveryInput): Promise<TrendDiscoveryResult> {
    return fetchJson<TrendDiscoveryResult>(
      "/api/pinterest-pod/trends/discover",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      "PINTEREST_DISCOVER_TRENDS_FAILED",
    );
  }

  public async rescueCandidate(jobId: string, candidateId: string): Promise<{ readonly ok: boolean; readonly candidate: PodCandidate }> {
    return fetchJson<{ readonly ok: boolean; readonly candidate: PodCandidate }>(
      `/api/pinterest-pod/jobs/${encodeURIComponent(jobId)}/rescue`,
      {
        method: "POST",
        body: JSON.stringify({ candidate_id: candidateId }),
      },
      "PINTEREST_RESCUE_CANDIDATE_FAILED",
    );
  }

  public async createJob(input: CreateJobInput): Promise<CreateJobOutput> {
    const product = input.product ?? inferProductTypeFromNiche(input.niche);
    const poolSize = input.candidatePoolSize ?? input.task5_max_downloads ?? input.top_images ?? 40;
    return fetchJson<CreateJobOutput>(
      "/api/pinterest-pod/jobs",
      {
        method: "POST",
        body: JSON.stringify({
          niche: input.niche,
          product,
          workflow_stage: input.workflow_stage ?? "crawl_and_review",
          ...(input.trend_type ? { trend_type: input.trend_type } : {}),
          ...(input.interest ? { interest: input.interest } : {}),
          ...(input.interests ? { interests: input.interests } : {}),
          ...(input.region ? { region: input.region } : {}),
          ...(input.selected_clusters ? { selected_clusters: input.selected_clusters } : {}),
          ...(input.custom_queries ? { custom_queries: input.custom_queries } : {}),
          candidatePoolSize: poolSize,
          task5_max_downloads: poolSize,
          top_images: poolSize,
          referenceImages: input.referenceImages ?? [],
          ...(input.ai_background_variants !== undefined ? { ai_background_variants: input.ai_background_variants } : {}),
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
    const product = input.product ?? (input.niche ? inferProductTypeFromNiche(input.niche) : undefined);
    return fetchJson<ProduceOutput>(
      "/api/pinterest-pod/jobs/produce",
      {
        method: "POST",
        body: JSON.stringify({
          jobId: input.jobId,
          selected_candidates: input.selected_candidates,
          ...(product ? { product } : {}),
          ...(input.niche ? { niche: input.niche } : {}),
          design_mode: input.design_mode ?? "direct_print",
          ...(input.referenceImages ? { referenceImages: input.referenceImages } : {}),
          ...(input.room_template_urls ? { room_template_urls: input.room_template_urls } : {}),
          ...(input.ai_background_variants !== undefined ? { ai_background_variants: input.ai_background_variants } : {}),
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

  public async getStatus(): Promise<PodStatusResponse> {
    return fetchJson<PodStatusResponse>(
      "/api/pinterest-pod/status",
      undefined,
      "PINTEREST_STATUS_FETCH_FAILED",
    );
  }

  public async deleteJob(jobId: string): Promise<{ readonly ok: boolean; readonly message?: string }> {
    return fetchJson<{ readonly ok: boolean; readonly message?: string }>(
      `/api/pinterest-pod/jobs/${encodeURIComponent(jobId)}/delete`,
      {
        method: "POST",
      },
      "PINTEREST_JOB_DELETE_FAILED",
    );
  }

  public async handoverToSeo(payload: PinterestPodDeliverables): Promise<SeoHandoverResponse> {
    return handoverToSeo(payload);
  }
}

/** Hand over final deliverables to the SEO Module */
export async function handoverToSeo(
  payload: PinterestPodDeliverables,
): Promise<SeoHandoverResponse> {
  return fetchJson<SeoHandoverResponse>(
    "/api/pinterest-pod/handover-seo",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    "PINTEREST_POD_SEO_HANDOVER_FAILED",
  );
}

export const realPinterestPodClient = new RealPinterestPodClient();
