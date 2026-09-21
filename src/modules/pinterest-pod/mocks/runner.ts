import type {
  PinterestAuthStatus,
  PinterestDiscoveryInput,
  PinterestDiscoveryOutput,
  PinterestLaunchLoginPayload,
  PinterestLaunchLoginResponse,
  PinterestPodDeliverables,
  PinterestProductionInput,
  PinterestProductionOutput,
  PodCandidate,
  PodDeliverableItem,
  PodJobStatusResponse,
  PodPollOptions,
} from "../types";
import { FACTORY_PRINT_STANDARDS } from "../types";
import {
  mock15Candidates,
  mockPinterestAuthStatus,
  mockSeoDeliverables,
  mockStage1DiscoveryOutput,
  mockStage2ProductionOutput,
} from "./data";

/** Deterministically clone candidates to avoid mutating shared mock state */
function cloneCandidates(candidates: readonly PodCandidate[]): PodCandidate[] {
  return candidates.map((cand) => ({ ...cand }));
}

/** Deterministically clone SEO deliverables items */
function cloneSeoItems(items: readonly PodDeliverableItem[]): PodDeliverableItem[] {
  return items.map((item) => ({
    ...item,
    trendKeywords: [...item.trendKeywords],
    printMaster: { ...item.printMaster },
    cutoutProduct: { ...item.cutoutProduct },
    composedMockups: item.composedMockups.map((m) => ({ ...m })),
  }));
}

/** Run mock Pinterest Discovery (Stage 1) */
export async function runMockDiscovery(
  input: PinterestDiscoveryInput,
  options?: PodPollOptions,
): Promise<PinterestDiscoveryOutput> {
  const targetPoolSize = input.candidatePoolSize ?? 15;
  const slicedCandidates = cloneCandidates(mock15Candidates.slice(0, targetPoolSize));
  const effectiveJobId = `job_pod_${Date.now().toString(36)}`;

  if (options?.onProgress) {
    options.onProgress({
      ok: true,
      jobId: effectiveJobId,
      status: "running",
      total_candidates: 0,
      stepper: {
        current_step: 1,
        percent: 20,
        current_message: `Đang quét từ khóa "${input.niche}" trên Pinterest...`,
      },
      logs: [`Khởi tạo job POD (crawl_and_review): ${input.niche}...`],
    });
  }

  return {
    ok: true,
    jobId: effectiveJobId,
    status: "ready_for_review",
    total_candidates: slicedCandidates.length,
    stepper: {
      current_step: 2,
      percent: 40,
      current_message: `Đã quét & chấm điểm Vision AI (${slicedCandidates.length} ứng viên). Mời bạn duyệt mẫu để sản xuất.`,
    },
    logs: [
      `Khởi tạo job POD (crawl_and_review): ${input.niche}...`,
      `Pinterest Trends: Đã phát hiện 8 từ khóa hot cho "${input.niche}"...`,
      `AI Vision: Đã chấm điểm chất lượng ${slicedCandidates.length} mẫu ứng viên.`,
      "Sẵn sàng duyệt mẫu ứng viên.",
    ],
    candidates: slicedCandidates,
  };
}

/** Run mock Pinterest Production (Stage 2) */
export async function runMockProduction(
  input: PinterestProductionInput,
  options?: PodPollOptions,
): Promise<PinterestProductionOutput> {
  const productType = input.product ?? "rug";
  const printStandard = FACTORY_PRINT_STANDARDS[productType];
  const selectedIds = new Set(input.selected_candidates);

  const matchedItems = mockSeoDeliverables.items.filter((item) =>
    selectedIds.size === 0 ? true : selectedIds.has(item.sourceCandidateId),
  );

  const effectiveItems = (matchedItems.length > 0 ? matchedItems : mockSeoDeliverables.items).map(
    (item) => ({
      ...item,
      productType,
      printMaster: {
        ...item.printMaster,
        widthPx: printStandard.widthPx,
        heightPx: printStandard.heightPx,
        label: printStandard.label,
        badge: printStandard.badge,
      },
    }),
  );

  const seoDeliverables: PinterestPodDeliverables = {
    workflowId: input.jobId,
    success: true,
    productType,
    totalProduced: effectiveItems.length,
    items: cloneSeoItems(effectiveItems),
  };

  if (options?.onProgress) {
    options.onProgress({
      ok: true,
      jobId: input.jobId,
      status: "running",
      stepper: {
        current_step: 3,
        percent: 75,
        current_message: "Đang render mockup phòng và tạo file CMYK 300 DPI...",
      },
      logs: [`Bắt đầu sản xuất ${effectiveItems.length} mẫu đã chọn...`],
    });
  }

  return {
    ok: true,
    jobId: input.jobId,
    status: "completed",
    stepper: {
      current_step: 4,
      percent: 100,
      current_message: "Hoàn thành! Đã tạo đầy đủ mockup AI & file in CMYK xưởng.",
    },
    logs: [
      `Khởi tạo sản xuất cho ${effectiveItems.length} mẫu ứng viên đã duyệt...`,
      "Đang tách phôi nền trắng (#ffffff) và phôi trong suốt...",
      `Đang chuyển hệ màu sang CMYK 300 DPI kích thước ${printStandard.widthPx}x${printStandard.heightPx}px...`,
      "Đang render AI Lifestyle Mockups theo các ảnh phòng mẫu...",
      "Hoàn thành toàn bộ quy trình sản xuất POD.",
    ],
    summaryMetrics: {
      rgb_4k_count: effectiveItems.length,
      cmyk_count: effectiveItems.length,
      lifestyle_mockup_count: effectiveItems.length * 2,
      cutouts_count: effectiveItems.length,
      mockups_count: effectiveItems.length * 2,
    },
    deliverables: {
      print_cmyk_images: (mockStage2ProductionOutput.deliverables.print_cmyk_images ?? []).map(
        (img) => ({
          ...img,
          width_px: printStandard.widthPx,
          height_px: printStandard.heightPx,
        }),
      ),
      final_png_images: (mockStage2ProductionOutput.deliverables.final_png_images ?? []).map(
        (img) => ({
          ...img,
          width_px: printStandard.widthPx,
          height_px: printStandard.heightPx,
        }),
      ),
      lifestyle_mockups: (mockStage2ProductionOutput.deliverables.lifestyle_mockups ?? []).map(
        (m) => ({ ...m }),
      ),
      product_cutouts_white: (
        mockStage2ProductionOutput.deliverables.product_cutouts_white ?? []
      ).map((c) => ({ ...c })),
      product_cutouts: (mockStage2ProductionOutput.deliverables.product_cutouts ?? []).map((c) => ({
        ...c,
      })),
      comparison_rows: (mockStage2ProductionOutput.deliverables.comparison_rows ?? []).map((r) => ({
        ...r,
        ai_background_urls: [...r.ai_background_urls],
      })),
    },
    seoDeliverables,
  };
}

/** Get mock Pinterest auth status */
export async function getMockAuthStatus(): Promise<PinterestAuthStatus> {
  return { ...mockPinterestAuthStatus };
}

/** Mock launch login */
export async function launchMockLogin(
  _payload?: PinterestLaunchLoginPayload,
): Promise<PinterestLaunchLoginResponse> {
  return {
    ok: true,
    status_text: "Pinterest: Đã mở cửa sổ và ghi nhận đăng nhập thành công",
    logged_in: true,
  };
}

/** Mock cancel job */
export async function cancelMockJob(jobId: string): Promise<{ ok: boolean; message?: string }> {
  return {
    ok: true,
    message: `Job ${jobId} đã được hủy thành công.`,
  };
}

/** Mock get job status */
export async function getMockJobStatus(jobId: string): Promise<PodJobStatusResponse> {
  return {
    ok: true,
    jobId,
    status: "ready_for_review",
    total_candidates: mock15Candidates.length,
    stepper: { ...mockStage1DiscoveryOutput.stepper },
    logs: [...mockStage1DiscoveryOutput.logs],
    candidates: cloneCandidates(mock15Candidates),
  };
}
