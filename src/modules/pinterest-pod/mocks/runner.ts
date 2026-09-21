import type {
  CandidateItem,
  CancelJobOutput,
  CreateJobInput,
  CreateJobOutput,
  DeliverablesData,
  JobDetailResponse,
  PinterestAuthStatus,
  PinterestLaunchLoginOutput,
  PinterestPodClient,
  ProduceInput,
  ProduceOutput,
  SummaryMetrics,
} from "../types";
import {
  createMockSvgDataUri,
  initialMockAuthStatus,
  initialMockLogs,
  mockCandidates,
  mockDeliverables,
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
    cutout_url: createMockSvgDataUri("Phôi bóc tách", "Transparent Cutout PNG", "#111827", "#818cf8"),
    cutout_white_url: product_cutouts_white[idx].url,
    final_print_url: print_cmyk_images[idx].url,
    ai_background_urls: [
      lifestyle_mockups[idx * 2].url,
      lifestyle_mockups[idx * 2 + 1].url,
    ],
  }));

  const summaryMetrics: SummaryMetrics = {
    rgb_4k_count: finalCandidates.length,
    cmyk_count: finalCandidates.length,
    lifestyle_mockup_count: lifestyle_mockups.length,
    cutouts_count: finalCandidates.length,
    mockups_count: lifestyle_mockups.length,
  };

  return {
    deliverables: {
      print_cmyk_images,
      lifestyle_mockups,
      product_cutouts_white,
      comparison_rows,
    },
    summaryMetrics,
  };
}

class MockPinterestPodClient implements PinterestPodClient {
  private authState: PinterestAuthStatus = { ...initialMockAuthStatus };
  private jobs = new Map<string, InMemoryMockJob>();

  public async getAuthStatus(): Promise<PinterestAuthStatus> {
    return { ...this.authState };
  }

  public async launchLogin(_timeout = 600): Promise<PinterestLaunchLoginOutput> {
    this.authState = {
      ok: true,
      logged_in: true,
      browser_logged_in: true,
      status_text: "Pinterest: Đã đăng nhập",
    };
    return {
      ok: true,
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
          current_message: "Đã quét & chấm điểm Vision AI (6 ứng viên). Mời bạn duyệt mẫu để sản xuất.",
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
      job.logs.push(
        `[${now}] Nhận lệnh sản xuất cho ${input.selected_candidates.length} mẫu đã chọn: [${input.selected_candidates.join(", ")}].`,
      );
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
}

export const mockPinterestPodClient = new MockPinterestPodClient();
