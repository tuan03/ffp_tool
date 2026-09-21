import { AppError } from "../../../shared/errors";
import type {
  CandidateItem,
  CancelJobOutput,
  CreateJobInput,
  CreateJobOutput,
  DeliverablesData,
  JobDetailResponse,
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
  PodCancelJobResponse,
  PodCandidate,
  PodDeliverableItem,
  PodJobStatusResponse,
  PodPollOptions,
  PodRecentRunItem,
  PodStatusResponse,
  ProduceInput,
  ProduceOutput,
  SummaryMetrics,
} from "../types";
import { FACTORY_PRINT_STANDARDS } from "../types";
import {
  createMockSvgDataUri,
  initialMockAuthStatus,
  initialMockLogs,
  mock15Candidates,
  mockCandidates,
  mockDeliverables,
  mockPinterestAuthStatus,
  mockSeoDeliverables,
  mockStage1DiscoveryOutput,
  mockStage2ProductionOutput,
  mockSummaryMetrics,
} from "./data";

interface InMemoryMockJob {
  id: string;
  niche: string;
  product: string;
  status: JobDetailResponse["status"];
  pollCount: number;
  selectedCandidateIds: string[];
  logs: string[];
  referenceImageCount: number;
  createdAt: number;
}

function buildMockDeliverablesForJob(job: InMemoryMockJob): {
  deliverables: DeliverablesData;
  summaryMetrics: SummaryMetrics;
} {
  const isBlanket = job.product === "blanket";
  const dimText = isBlanket ? "10000x11000px - 300 DPI" : "4000x6400px - 300 DPI";
  const prodLabel = isBlanket ? "Chăn Blanket" : "Thảm Rug";

  const selectedCandidates =
    job.selectedCandidateIds.length > 0
      ? job.selectedCandidateIds
          .map((id) => mockCandidates.find((c) => c.id === id))
          .filter((c): c is CandidateItem => Boolean(c))
      : mockCandidates.slice(0, 3);

  const finalCandidates = selectedCandidates.length > 0 ? selectedCandidates : mockCandidates.slice(0, 3);

  const print_cmyk_images = finalCandidates.map((cand, idx) => ({
    filename: `design_${String(idx + 1).padStart(2, "0")}_cmyk_300dpi.jpg`,
    url: createMockSvgDataUri(
      `BẢN IN CMYK #${idx + 1}`,
      `${prodLabel} ${dimText}`,
      "#1e1b4b",
      "#818cf8",
    ),
    download_url: createMockSvgDataUri(
      `BẢN IN CMYK #${idx + 1}`,
      `${prodLabel} ${dimText}`,
      "#1e1b4b",
      "#818cf8",
    ),
  }));

  const product_cutouts_white = finalCandidates.map((cand, idx) => ({
    filename: `design_${String(idx + 1).padStart(2, "0")}_white.jpg`,
    url: createMockSvgDataUri(
      `PHÔI CẮT NỀN TRẮNG #${idx + 1}`,
      "Pure White Background #ffffff",
      "#ffffff",
      "#0284c7",
    ),
  }));

  const lifestyle_mockups = finalCandidates.flatMap((cand, idx) => [
    {
      filename: `mockup_living_room_design_${String(idx + 1).padStart(2, "0")}.jpg`,
      url: createMockSvgDataUri(
        `MOCKUP PHÒNG KHÁCH AI #${idx + 1}`,
        `Living room: ${cand.title.slice(0, 24)}`,
        "#1a2238",
        "#60a5fa",
      ),
      scene_type: "living_room",
      scene_description: `Phòng khách hiện đại với sofa da bò nâu, bàn trà gỗ và ${prodLabel.toLowerCase()} phong cách ${cand.trend}.`,
    },
    {
      filename: `mockup_bedroom_design_${String(idx + 1).padStart(2, "0")}.jpg`,
      url: createMockSvgDataUri(
        `MOCKUP PHÒNG NGỦ AI #${idx + 1}`,
        `Bedroom: ${cand.title.slice(0, 24)}`,
        "#2b1c2b",
        "#f472b6",
      ),
      scene_type: "bedroom",
      scene_description: `Phòng ngủ phong cách tối giản ấm cúng với sàn gỗ sồi và ${prodLabel.toLowerCase()}.`,
    },
  ]);

  const comparison_rows = finalCandidates.map((cand, idx) => ({
    index: idx + 1,
    product_label: `Mẫu #${idx + 1}: ${cand.title}`,
    source_url: cand.image_url,
    cutout_url: createMockSvgDataUri(
      `Phôi bóc tách #${idx + 1}`,
      "Transparent Cutout PNG",
      "#111827",
      "#818cf8",
    ),
    cutout_white_url: createMockSvgDataUri(
      `Phôi nền trắng #${idx + 1}`,
      "Pure #ffffff Background",
      "#ffffff",
      "#818cf8",
    ),
    final_print_url: createMockSvgDataUri(
      `File CMYK #${idx + 1}`,
      `${prodLabel} ${dimText}`,
      "#1e1b4b",
      "#818cf8",
    ),
    ai_background_urls: [
      createMockSvgDataUri(
        `Mockup AI #${idx + 1}A`,
        "Living Room",
        "#1a2238",
        "#60a5fa",
      ),
      createMockSvgDataUri(
        `Mockup AI #${idx + 1}B`,
        "Bedroom",
        "#2b1c2b",
        "#f472b6",
      ),
    ],
  }));

  return {
    deliverables: {
      print_cmyk_images,
      lifestyle_mockups,
      product_cutouts_white,
      comparison_rows,
    },
    summaryMetrics: {
      rgb_4k_count: finalCandidates.length,
      cmyk_count: print_cmyk_images.length,
      lifestyle_mockup_count: lifestyle_mockups.length,
      cutouts_count: product_cutouts_white.length,
      mockups_count: lifestyle_mockups.length,
    },
  };
}

export class MockPinterestPodClient implements PinterestPodClient {
  private authState: PinterestAuthStatus = { ...initialMockAuthStatus };
  private jobs = new Map<string, InMemoryMockJob>();

  public async getAuthStatus(): Promise<PinterestAuthStatus> {
    return { ...this.authState };
  }

  public async launchLogin(_timeout?: number): Promise<PinterestLaunchLoginOutput> {
    this.authState = {
      ok: true,
      logged_in: true,
      browser_logged_in: true,
      status_text: "Pinterest: Đã đăng nhập (Phiên duyệt)",
    };
    return {
      ok: true,
      status_text: "Pinterest: Đã đăng nhập (Phiên duyệt)",
      message: "Đăng nhập Pinterest thành công trên phiên trình duyệt.",
    };
  }

  public async createJob(input: CreateJobInput): Promise<CreateJobOutput> {
    const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toLocaleTimeString("vi-VN", { hour12: false });
    const initialLogs: string[] = [
      `[${now}] Khởi tạo job POD (${input.workflow_stage ?? "crawl_and_review"}): "${input.niche}"...`,
      `[${now}] Đã nạp ${input.referenceImages?.length ?? 0} ảnh phòng tham chiếu vào bộ nhớ tạm.`,
      `[${now}] Bắt đầu quét xu hướng Pinterest niche "${input.niche}"...`,
    ];

    const newJob: InMemoryMockJob = {
      id: jobId,
      niche: input.niche,
      product: input.product,
      status: "running",
      pollCount: 0,
      selectedCandidateIds: [],
      logs: initialLogs,
      referenceImageCount: input.referenceImages?.length ?? 0,
      createdAt: Date.now(),
    };

    this.jobs.set(jobId, newJob);

    return {
      ok: true,
      jobId,
      job_id: jobId,
      status: "running",
      logs: [...initialLogs],
    };
  }

  public async getJobDetail(jobId: string): Promise<JobDetailResponse> {
    const job = this.jobs.get(jobId);
    const now = new Date().toLocaleTimeString("vi-VN", { hour12: false });

    if (!job) {
      // Default fallback mock job for testing or direct navigation
      return {
        ok: true,
        jobId,
        job_id: jobId,
        status: "ready_for_review",
        total_candidates: mockCandidates.length,
        stepper: {
          current_step: 2,
          percent: 40,
          current_message: `Đã quét & chấm điểm Vision AI (${mockCandidates.length} ứng viên). Mời bạn duyệt mẫu để sản xuất.`,
        },
        logs: [...initialMockLogs],
        candidates: [...mockCandidates],
      };
    }

    job.pollCount += 1;

    if (job.status === "running") {
      if (job.pollCount >= 2) {
        job.status = "ready_for_review";
        job.logs.push(
          `[${now}] Pinterest Trends: Phát hiện 8 từ khóa hot và quét 30 ghim liên quan.`,
          `[${now}] AI Vision: Đã chấm điểm chất lượng và độ phẳng cho ${mockCandidates.length} ứng viên.`,
          `[${now}] Sẵn sàng duyệt mẫu ứng viên. Mời bạn chọn mẫu để tiến hành sản xuất.`,
        );
      } else {
        job.logs.push(`[${now}] Đang tải ảnh độ phân giải cao và phân tích Vision AI...`);
        return {
          ok: true,
          jobId: job.id,
          job_id: job.id,
          status: "running",
          stepper: {
            current_step: 1,
            percent: 25,
            current_message: `Đang cào Pinterest niche: "${job.niche}"...`,
          },
          logs: [...job.logs],
        };
      }
    }

    if (job.status === "ready_for_review") {
      return {
        ok: true,
        jobId: job.id,
        job_id: job.id,
        status: "ready_for_review",
        total_candidates: mockCandidates.length,
        stepper: {
          current_step: 2,
          percent: 40,
          current_message: `Đã quét & chấm điểm Vision AI (${mockCandidates.length} ứng viên). Mời bạn duyệt mẫu để sản xuất.`,
        },
        logs: [...job.logs],
        candidates: [...mockCandidates],
      };
    }

    if (job.status === "producing") {
      const isBlanket = job.product === "blanket";
      const dim = isBlanket ? "10000x11000px" : "4000x6400px";

      if (job.pollCount >= 2) {
        job.status = "completed";
        job.logs.push(
          `[${now}] AI Vision: Bóc tách phôi nền trắng thành công.`,
          `[${now}] Color Engine: Xuất file in CMYK 300 DPI (${dim}) chuẩn xưởng.`,
          `[${now}] Lifestyle AI: Render thành công mockup phòng thực tế.`,
          `[${now}] Hoàn thành toàn bộ quy trình sản xuất! Sẵn sàng bàn giao SEO.`,
        );
      } else {
        job.logs.push(`[${now}] Đang tiến hành tạo file CMYK 300 DPI (${dim}) và render mockup AI...`);
        return {
          ok: true,
          jobId: job.id,
          job_id: job.id,
          status: "producing",
          stepper: {
            current_step: 3,
            percent: 75,
            current_message: `Đang sản xuất file in CMYK 300 DPI (${dim}) & render phối cảnh mockup AI...`,
          },
          logs: [...job.logs],
        };
      }
    }

    if (job.status === "completed") {
      const { deliverables, summaryMetrics } = buildMockDeliverablesForJob(job);
      return {
        ok: true,
        jobId: job.id,
        job_id: job.id,
        status: "completed",
        stepper: {
          current_step: 4,
          percent: 100,
          current_message: "Hoàn thành! Đã tạo đầy đủ mockup AI & file in CMYK chuẩn xưởng.",
        },
        logs: [...job.logs],
        candidates: [...mockCandidates],
        summaryMetrics,
        summary_metrics: summaryMetrics,
        deliverables,
      };
    }

    if (job.status === "cancelled") {
      return {
        ok: true,
        jobId: job.id,
        job_id: job.id,
        status: "cancelled",
        stepper: {
          current_step: 1,
          percent: 0,
          current_message: "Tiến trình đã bị dừng bởi người dùng.",
        },
        logs: [...job.logs],
      };
    }

    return {
      ok: true,
      jobId: job.id,
      job_id: job.id,
      status: job.status,
      logs: [...job.logs],
    };
  }

  public async produce(input: ProduceInput): Promise<ProduceOutput> {
    const job = this.jobs.get(input.jobId);
    const now = new Date().toLocaleTimeString("vi-VN", { hour12: false });

    if (job) {
      job.status = "producing";
      job.pollCount = 0;
      job.selectedCandidateIds = [...input.selected_candidates];
      const refCount = input.referenceImages?.length ?? job.referenceImageCount ?? 0;
      job.referenceImageCount = refCount;
      job.logs.push(
        `[${now}] Nhận lệnh sản xuất cho ${input.selected_candidates.length} mẫu đã chọn: [${input.selected_candidates.join(", ")}].`,
      );
      if (refCount > 0) {
        job.logs.push(
          `[${now}] Bối cảnh: Đã áp dụng ${refCount} ảnh phòng tham chiếu cho khâu render Mockup AI.`,
        );
      }
    }

    return {
      ok: true,
      status: "producing",
    };
  }

  public async cancelJob(jobId: string): Promise<CancelJobOutput> {
    const job = this.jobs.get(jobId);
    const now = new Date().toLocaleTimeString("vi-VN", { hour12: false });

    if (job) {
      job.status = "cancelled";
      job.logs.push(`[${now}] Người dùng đã bấm hủy tiến trình.`);
    }

    return {
      ok: true,
      status: "cancelled",
    };
  }

  public async getStatus(): Promise<PodStatusResponse> {
    const recent: PodRecentRunItem[] = [];
    for (const [id, job] of this.jobs.entries()) {
      recent.push({
        type: "cached_job",
        id,
        jobId: id,
        status: job.status,
        createdAt: job.createdAt,
        title: job.niche,
        niche: job.niche,
        product: job.product,
        productType: job.product,
        candidateCount: job.status === "ready_for_review" || job.status === "completed" ? mock15Candidates.length : 0,
      });
    }
    // If no dynamic jobs created yet in mock, provide default mock history fixture
    if (recent.length === 0) {
      recent.push({
        type: "cached_job",
        id: "job_mock_rug_vintage",
        jobId: "job_mock_rug_vintage",
        status: "ready_for_review",
        createdAt: Date.now() - 15 * 60 * 1000,
        title: "vintage distressed rug",
        niche: "vintage distressed rug",
        product: "rug",
        productType: "rug",
        candidateCount: mock15Candidates.length,
      });
    }
    return {
      ok: true,
      service: {
        online: true,
        port: 8765,
      },
      recent,
    };
  }

  public async deleteJob(jobId: string): Promise<{ readonly ok: boolean; readonly message?: string }> {
    this.jobs.delete(jobId);
    return {
      ok: true,
      message: `Mock job ${jobId} deleted successfully.`,
    };
  }
}

export const mockPinterestPodClient = new MockPinterestPodClient();

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
  if (options?.signal?.aborted) {
    throw new AppError("Polling Pinterest POD job was aborted", "PINTEREST_POD_JOB_ABORTED");
  }

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
  if (options?.signal?.aborted) {
    throw new AppError("Polling Pinterest POD job was aborted", "PINTEREST_POD_JOB_ABORTED");
  }

  const productType = input.product ?? "rug";
  const printStandard = FACTORY_PRINT_STANDARDS[productType];
  const selectedIds = input.selected_candidates ?? [];

  const candidateLookup = new Map<string, PodCandidate>();
  for (const c of mock15Candidates) {
    candidateLookup.set(c.id, c);
  }
  const seoItemsLookup = new Map<string, PodDeliverableItem>();
  for (const it of mockSeoDeliverables.items) {
    seoItemsLookup.set(it.sourceCandidateId, it);
  }

  const effectiveItems: PodDeliverableItem[] = (
    selectedIds.length > 0 ? selectedIds : ["cand_pin_101", "cand_pin_102", "cand_pin_105"]
  ).map((candId, idx) => {
    const existingSeo = seoItemsLookup.get(candId);
    if (existingSeo) {
      return {
        ...existingSeo,
        productType,
        printMaster: {
          ...existingSeo.printMaster,
          widthPx: printStandard.widthPx,
          heightPx: printStandard.heightPx,
          label: printStandard.label,
          badge: printStandard.badge,
        },
      };
    }

    const cand = candidateLookup.get(candId);
    const designId = `design_${productType}_${100 + idx + 1}`;
    const originalPinTitle = cand?.title ?? `Design #${idx + 1}`;
    const trendKeywords = cand?.trend
      ? [cand.trend, cand.query ?? "", `${productType} aesthetic`].filter(Boolean)
      : [`${productType} aesthetic`, "vintage trend", "lifestyle home"];

    return {
      designId,
      sourceCandidateId: candId,
      productType,
      originalPinTitle,
      trendKeywords,
      printMaster: {
        cmykUrl: `/api/pinterest-pod/assets/${input.jobId}/${designId}_cmyk_300dpi.jpg`,
        rgbUrl: `/api/pinterest-pod/assets/${input.jobId}/${designId}_rgb_4k.png`,
        localFilePath: `temp/pinterest_pod/${input.jobId}/${designId}_cmyk_300dpi.jpg`,
        widthPx: printStandard.widthPx,
        heightPx: printStandard.heightPx,
        dpi: 300,
        colorMode: "CMYK",
        label: printStandard.label,
        badge: printStandard.badge,
      },
      cutoutProduct: {
        transparentUrl: `/api/pinterest-pod/assets/${input.jobId}/${designId}_cutout.png`,
        whiteBgUrl: `/api/pinterest-pod/assets/${input.jobId}/${designId}_white.jpg`,
        localFilePath: `temp/pinterest_pod/${input.jobId}/${designId}_white.jpg`,
      },
      composedMockups: [
        {
          referenceImageId: "ref_room_01",
          mockupUrl: `/api/pinterest-pod/assets/${input.jobId}/mockup_room_01_${designId}.jpg`,
          localFilePath: `temp/pinterest_pod/${input.jobId}/mockup_room_01_${designId}.jpg`,
          detectedSceneType: "living_room",
          detectedSceneDescription: "Modern spacious living room with natural sunlight and couch",
        },
        {
          referenceImageId: "ref_room_02",
          mockupUrl: `/api/pinterest-pod/assets/${input.jobId}/mockup_room_02_${designId}.jpg`,
          localFilePath: `temp/pinterest_pod/${input.jobId}/mockup_room_02_${designId}.jpg`,
          detectedSceneType: "bedroom",
          detectedSceneDescription: "Cozy minimalist bedroom with hardwood flooring and bedding",
        },
      ],
    };
  });

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
export async function cancelMockJob(jobId: string): Promise<PodCancelJobResponse> {
  return {
    ok: true,
    jobId,
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
