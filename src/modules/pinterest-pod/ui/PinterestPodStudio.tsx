import { useEffect, useMemo, useRef, useState } from "react";

import { inferProductTypeFromNiche, packageDeliverablesForSeo, realPinterestPodClient } from "../service";
import type {
  CandidateItem,
  DeliverablesData,
  JobDetailResponse,
  JobStatus,
  PinterestAuthStatus,
  PinterestPodClient,
  PinterestProductType,
  PodRecentRunItem,
  ReferenceImage,
  StepperState,
  SummaryMetrics,
} from "../types";
import { CandidateReviewGrid } from "./components/CandidateReviewGrid";
import { DeliverablesShowcase } from "./components/DeliverablesShowcase";
import { HeaderBar } from "./components/HeaderBar";
import { ImageLightboxModal, type LightboxImageItem } from "./components/ImageLightboxModal";
import { InitForm } from "./components/InitForm";
import { PinterestAuthModal } from "./components/PinterestAuthModal";
import { ProgressAndLogs } from "./components/ProgressAndLogs";
import { RecentRunsAccordion } from "./components/RecentRunsAccordion";
import { RoomTemplateManagerModal } from "./components/RoomTemplateManagerModal";

interface PinterestPodStudioProps {
  readonly client?: PinterestPodClient;
}

export function PinterestPodStudio({ client: injectedClient }: PinterestPodStudioProps = {}): React.JSX.Element {
  const client = useMemo(() => injectedClient ?? realPinterestPodClient, [injectedClient]);

  // Auth State
  const [authStatus, setAuthStatus] = useState<PinterestAuthStatus | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Form State
  const [niche, setNiche] = useState("vintage distressed rug");
  const [product, setProduct] = useState<PinterestProductType>("rug");
  const [crawlCount, setCrawlCount] = useState(40);
  const [referenceImages, setReferenceImages] = useState<readonly ReferenceImage[]>([]);

  // Job State
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [stepper, setStepper] = useState<StepperState | undefined>(undefined);
  const [logs, setLogs] = useState<readonly string[]>([]);
  const [candidates, setCandidates] = useState<readonly CandidateItem[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<readonly string[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverablesData | undefined>(undefined);
  const [summaryMetrics, setSummaryMetrics] = useState<SummaryMetrics | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProducing, setIsProducing] = useState(false);

  // Recent Runs State
  const [recentRuns, setRecentRuns] = useState<readonly PodRecentRunItem[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);

  // Current stage active pill
  const [currentStage, setCurrentStage] = useState<1 | 2 | 3>(1);

  // Lightbox preview state
  const [previewImage, setPreviewImage] = useState<LightboxImageItem | null>(null);
  const [isRoomManagerOpen, setIsRoomManagerOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  function handlePreviewCandidate(candidate: CandidateItem): void {
    setPreviewImage({
      url: candidate.image_url,
      title: candidate.title,
      subtitle: candidate.reason || `Mẫu ứng viên Pinterest (Score nét: ${candidate.image_score}/100, Chuẩn in: ${candidate.printability_score}/100)`,
      badge: candidate.is_direct_printable ? "Chuẩn in trực tiếp" : candidate.recommended ? "Khuyên chọn" : undefined,
      score: candidate.image_score,
      printability: candidate.printability_score,
      tags: candidate.is_direct_printable ? ["direct_print", "pinterest"] : ["pinterest"],
      downloadUrl: candidate.image_url,
    });
  }

  function handlePreviewThumbnail(url: string, title: string): void {
    setPreviewImage({
      url,
      title,
      subtitle: "Ảnh xem trước trong kho dữ liệu Run",
      badge: "Run Asset",
      downloadUrl: url,
    });
  }

  function handleReuseNiche(reusedNiche: string, reusedProduct?: PinterestProductType): void {
    setNiche(reusedNiche);
    setProduct(reusedProduct ?? inferProductTypeFromNiche(reusedNiche));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Refs for scrolling to sections and lifecycle safety
  const stage2Ref = useRef<HTMLDivElement | null>(null);
  const stage3Ref = useRef<HTMLDivElement | null>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const isPollingBusyRef = useRef(false);

  // Stop polling helper
  function stopPolling(): void {
    if (pollingTimerRef.current !== null) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }

  // Load recent jobs and runs from server
  async function loadRecentRuns(): Promise<readonly PodRecentRunItem[]> {
    setIsLoadingRecent(true);
    try {
      const statusRes = await client.getStatus();
      if (isMountedRef.current && statusRes.recent) {
        setRecentRuns(statusRes.recent);
        return statusRes.recent;
      }
    } catch {
      // Ignore if offline
    } finally {
      if (isMountedRef.current) {
        setIsLoadingRecent(false);
      }
    }
    return [];
  }

  // Load existing job / run (e.g. from history or localStorage)
  async function handleLoadJob(targetJobId: string): Promise<void> {
    if (!targetJobId) return;
    stopPolling();
    setErrorMessage(null);
    try {
      const detail: JobDetailResponse = await client.getJobDetail(targetJobId);
      if (!isMountedRef.current) return;

      setJobId(targetJobId);
      try {
        localStorage.setItem("pinterest_pod_active_job_id", targetJobId);
      } catch {
        // Ignore localStorage errors
      }
      setJobStatus(detail.status);

      if (detail.niche) {
        setNiche(detail.niche);
      }
      if (detail.product) {
        setProduct(detail.product);
      }
      if (detail.stepper) {
        setStepper(detail.stepper);
      }
      if (detail.logs && detail.logs.length > 0) {
        setLogs(detail.logs);
      }
      if (detail.candidates && detail.candidates.length > 0) {
        const normalized = detail.candidates.map((c, idx) => ({
          ...c,
          id: c.id || c.candidate_id || c.image_id || `cand_${idx + 1}`,
        }));
        setCandidates(normalized);
        setSelectedCandidateIds(normalized.filter((c) => c.recommended).map((c) => c.id));
      } else {
        setCandidates([]);
        setSelectedCandidateIds([]);
      }
      if (detail.deliverables) {
        setDeliverables(detail.deliverables);
      } else {
        setDeliverables(undefined);
      }
      if (detail.summaryMetrics || detail.summary_metrics) {
        setSummaryMetrics(detail.summaryMetrics ?? detail.summary_metrics);
      } else {
        setSummaryMetrics(undefined);
      }

      // Hydrate room templates from backend
      const loadedTemplates = detail.roomTemplates ?? detail.room_templates ?? detail.referenceImages ?? detail.reference_images;
      if (loadedTemplates && loadedTemplates.length > 0) {
        setReferenceImages(
          loadedTemplates.map((rt: any, idx: number) => ({
            id: rt.id || `rt_${idx + 1}`,
            url: rt.url || (typeof rt === "string" ? rt : ""),
            name: rt.name || (typeof rt === "string" ? rt.split("/").pop() : `Phòng Mẫu #${idx + 1}`),
          })),
        );
      } else {
        setReferenceImages([]);
      }

      if (detail.status === "running" || detail.status === "producing") {
        stopPolling();
        pollingTimerRef.current = setInterval(() => {
          void pollJob(targetJobId);
        }, 1500);
        const isProdJob = targetJobId.startsWith("job_prod_") || (detail.stepper && detail.stepper.current_step >= 3);
        if (isProdJob) {
          setIsProducing(true);
          setCurrentStage(3);
          setTimeout(() => {
            if (isMountedRef.current) {
              stage3Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }, 150);
        } else {
          setIsProducing(false);
          setCurrentStage(1);
        }
      } else if (
        detail.status === "completed" ||
        (detail.deliverables && (detail.deliverables.print_cmyk_images?.length ?? 0) > 0)
      ) {
        setCurrentStage(3);
        setIsProducing(false);
        stopPolling();
        setTimeout(() => {
          if (isMountedRef.current) {
            stage3Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 150);
      } else if (detail.status === "ready_for_review" || (detail.candidates && detail.candidates.length > 0)) {
        setCurrentStage(2);
        setIsProducing(false);
        stopPolling();
        setTimeout(() => {
          if (isMountedRef.current) {
            stage2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 150);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : `Không thể tải dữ liệu job ${targetJobId}`);
    }
  }

  // Delete existing job
  async function handleDeleteJob(targetJobId: string): Promise<void> {
    try {
      await client.deleteJob(targetJobId);
      if (jobId === targetJobId) {
        setJobId(null);
        try {
          localStorage.removeItem("pinterest_pod_active_job_id");
        } catch {
          // Ignore
        }
        setCandidates([]);
        setSelectedCandidateIds([]);
        setDeliverables(undefined);
        setJobStatus("idle");
        setCurrentStage(1);
      }
      await loadRecentRuns();
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : "Xóa job thất bại");
    }
  }

  // Start a new job (reset active session)
  function handleNewJob(): void {
    stopPolling();
    setJobId(null);
    try {
      localStorage.removeItem("pinterest_pod_active_job_id");
    } catch {
      // Ignore
    }
    setJobStatus("idle");
    setCandidates([]);
    setSelectedCandidateIds([]);
    setDeliverables(undefined);
    setSummaryMetrics(undefined);
    setLogs([]);
    setStepper(undefined);
    setErrorMessage(null);
    setIsProducing(false);
    setCurrentStage(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Check auth status & recent runs on mount, and restore active job if present
  useEffect(() => {
    isMountedRef.current = true;

    async function initialize(): Promise<void> {
      try {
        const res = await client.getAuthStatus();
        if (isMountedRef.current) {
          setAuthStatus(res);
        }
      } catch {
        if (isMountedRef.current) {
          setAuthStatus({
            ok: false,
            logged_in: false,
            status_text: "Pinterest: Chưa kết nối máy chủ",
          });
        }
      }

      const runs = await loadRecentRuns();
      if (!isMountedRef.current) return;

      let savedJobId: string | null = null;
      try {
        savedJobId = localStorage.getItem("pinterest_pod_active_job_id");
      } catch {
        // Ignore
      }

      if (savedJobId) {
        void handleLoadJob(savedJobId);
      } else if (runs.length > 0) {
        // Auto-load latest ready_for_review job (e.g. job_f4b23b5a86) if available
        const preferred = runs.find((r) => r.status === "ready_for_review") || runs[0];
        const targetId = preferred.jobId || preferred.job_id || preferred.id;
        if (targetId) {
          void handleLoadJob(targetId);
        }
      }
    }

    void initialize();

    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, [client]);

  async function refreshAuthStatus(): Promise<void> {
    try {
      const res = await client.getAuthStatus();
      if (isMountedRef.current) {
        setAuthStatus(res);
      }
    } catch {
      // Ignore offline errors
    }
  }

  // Handle Pinterest login launch
  async function handleLaunchLogin(): Promise<void> {
    setIsLoggingIn(true);
    setErrorMessage(null);
    try {
      await client.launchLogin(600);
      if (!isMountedRef.current) return;
      await refreshAuthStatus();
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : "Đăng nhập Pinterest thất bại");
    } finally {
      if (isMountedRef.current) {
        setIsLoggingIn(false);
      }
    }
  }

  // Poll job status
  async function pollJob(targetJobId: string): Promise<void> {
    if (!isMountedRef.current || isPollingBusyRef.current) return;
    isPollingBusyRef.current = true;

    try {
      const detail: JobDetailResponse = await client.getJobDetail(targetJobId);
      if (!isMountedRef.current) return;

      setJobStatus(detail.status);

      if (detail.stepper) {
        setStepper(detail.stepper);
      }
      if (detail.logs && detail.logs.length > 0) {
        setLogs(detail.logs);
      }
      if (detail.candidates && detail.candidates.length > 0) {
        const normalized = detail.candidates.map((c, idx) => ({
          ...c,
          id: c.id || c.candidate_id || c.image_id || `cand_${idx + 1}`,
        }));
        setCandidates(normalized);
        // Pre-select recommended candidates by default if none selected yet
        setSelectedCandidateIds((prev) => {
          if (prev.length > 0) return prev;
          return normalized.filter((c) => c.recommended).map((c) => c.id);
        });
      }
      if (detail.deliverables) {
        setDeliverables(detail.deliverables);
      }
      if (detail.summaryMetrics || detail.summary_metrics) {
        setSummaryMetrics(detail.summaryMetrics ?? detail.summary_metrics);
      }

      // Hydrate room templates if present and local state is empty
      const loadedTemplates = detail.roomTemplates ?? detail.room_templates ?? detail.referenceImages ?? detail.reference_images;
      if (loadedTemplates && loadedTemplates.length > 0) {
        setReferenceImages((prev) => {
          if (prev.length > 0) return prev;
          return loadedTemplates.map((rt: any, idx: number) => ({
            id: rt.id || `rt_${idx + 1}`,
            url: rt.url || (typeof rt === "string" ? rt : ""),
            name: rt.name || (typeof rt === "string" ? rt.split("/").pop() : `Phòng Mẫu #${idx + 1}`),
          }));
        });
      }

      if (detail.status === "running" || detail.status === "producing") {
        if (targetJobId.startsWith("job_prod_") || (detail.stepper && detail.stepper.current_step >= 3)) {
          setIsProducing(true);
          setCurrentStage(3);
        }
      } else if (detail.status === "ready_for_review") {
        setCurrentStage(2);
        stopPolling();
        void loadRecentRuns();
        setTimeout(() => {
          if (isMountedRef.current) {
            stage2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 150);
      } else if (detail.status === "completed") {
        setCurrentStage(3);
        setIsProducing(false);
        stopPolling();
        void loadRecentRuns();
        setTimeout(() => {
          if (isMountedRef.current) {
            stage3Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 150);
      } else if (detail.status === "failed" || detail.status === "cancelled") {
        setIsProducing(false);
        stopPolling();
        void loadRecentRuns();
        if (detail.error) {
          setErrorMessage(detail.error);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : "Lỗi khi cập nhật trạng thái job");
      stopPolling();
      setIsProducing(false);
    } finally {
      isPollingBusyRef.current = false;
    }
  }

  // Start Crawl (Stage 1 action)
  async function handleStartCrawl(): Promise<void> {
    if (!niche.trim()) return;

    setErrorMessage(null);
    setJobStatus("running");
    setCurrentStage(1);
    setCandidates([]);
    setSelectedCandidateIds([]);
    setDeliverables(undefined);
    setSummaryMetrics(undefined);
    setStepper({
      current_step: 1,
      percent: 15,
      current_message: `Đang quét từ khóa và cào ảnh niche "${niche}"...`,
    });

    const effectiveProduct = inferProductTypeFromNiche(niche);
    setProduct(effectiveProduct);
    const effectiveVariants = referenceImages.length > 0 ? referenceImages.length : 5;

    try {
      const created = await client.createJob({
        niche: niche.trim(),
        product: effectiveProduct,
        workflow_stage: "crawl_and_review",
        candidatePoolSize: crawlCount,
        task5_max_downloads: crawlCount,
        top_images: crawlCount,
        referenceImages,
        ai_background_variants: effectiveVariants,
      });

      setJobId(created.jobId);
      try {
        localStorage.setItem("pinterest_pod_active_job_id", created.jobId);
      } catch {
        // Ignore
      }
      void loadRecentRuns();

      if (!isMountedRef.current) return;
      if (created.logs) {
        setLogs(created.logs);
      }

      stopPolling();
      pollingTimerRef.current = setInterval(() => {
        void pollJob(created.jobId);
      }, 1500);
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : "Không thể khởi tạo job cào Pinterest");
      setJobStatus("idle");
    }
  }

  // Stop Job
  async function handleStopJob(): Promise<void> {
    if (!jobId) return;
    try {
      await client.cancelJob(jobId);
      if (!isMountedRef.current) return;
      setJobStatus("cancelled");
      stopPolling();
      setIsProducing(false);
      void loadRecentRuns();
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : "Hủy job thất bại");
    }
  }

  // Toggle candidate selection
  function handleToggleCandidate(id: string): void {
    if (!id) return;
    setSelectedCandidateIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function handleSelectAll(): void {
    setSelectedCandidateIds(candidates.map((c) => c.id || c.candidate_id || c.image_id || ""));
  }

  function handleSelectDirectPrintableOnly(): void {
    setSelectedCandidateIds(
      candidates
        .filter((c) => c.is_direct_printable || c.printability_score > 85)
        .map((c) => c.id || c.candidate_id || c.image_id || ""),
    );
  }

  function handleDeselectAll(): void {
    setSelectedCandidateIds([]);
  }

  function handleRemoveRoomTemplate(id: string): void {
    setReferenceImages((prev) => prev.filter((img) => img.id !== id));
  }

  function handleUseCandidateAsRoomTemplate(candidate: CandidateItem): void {
    const candId = candidate.id || candidate.candidate_id || candidate.image_id || "";
    setReferenceImages((prev) => {
      const exists = prev.some((img) => img.id === candId || img.url === candidate.image_url);
      if (exists) {
        return prev.filter((img) => img.id !== candId && img.url !== candidate.image_url);
      }
      const newTemplate: ReferenceImage = {
        id: candId,
        url: candidate.image_url,
        name: candidate.title ? candidate.title.slice(0, 30) : "Phòng Mẫu Pinterest",
      };
      return [...prev, newTemplate];
    });
  }

  // Produce Action (Stage 2 -> Stage 3)
  async function handleProduce(): Promise<void> {
    if (!jobId || selectedCandidateIds.length === 0) return;

    setIsProducing(true);
    setErrorMessage(null);
    setJobStatus("producing");
    setCurrentStage(3);
    setDeliverables(undefined);
    setSummaryMetrics(undefined);
    setStepper({
      current_step: 3,
      percent: 60,
      current_message: `Đang chuẩn bị file in CMYK 300DPI và render mockup AI cho ${selectedCandidateIds.length} mẫu đã chọn...`,
    });
    setTimeout(() => {
      if (isMountedRef.current) {
        stage3Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);

    const effectiveVariants = referenceImages.length > 0 ? referenceImages.length : 5;
    try {
      const produceRes = await client.produce({
        jobId,
        selected_candidates: selectedCandidateIds,
        product,
        niche,
        design_mode: "direct_print",
        referenceImages,
        ai_background_variants: effectiveVariants,
      });
      if (!isMountedRef.current) return;

      const targetJobId = produceRes.jobId || jobId;
      setJobId(targetJobId);
      try {
        localStorage.setItem("pinterest_pod_active_job_id", targetJobId);
      } catch {
        // Ignore
      }
      void loadRecentRuns();

      stopPolling();
      pollingTimerRef.current = setInterval(() => {
        void pollJob(targetJobId);
      }, 1500);
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : "Không thể gửi lệnh sản xuất");
      setIsProducing(false);
    }
  }

  // Stage navigation from header pills
  function handleSelectStage(stage: 1 | 2 | 3): void {
    setCurrentStage(stage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Packaged SEO payload when deliverables available
  const seoPayload = useMemo(() => {
    if (!deliverables || !jobId) return undefined;
    return packageDeliverablesForSeo(
      {
        ok: true,
        jobId,
        status: "completed",
        deliverables,
        candidates,
      },
      product,
    );
  }, [deliverables, jobId, candidates, product]);

  const hasStage2 = candidates.length > 0 || jobStatus === "ready_for_review";
  const hasDeliverables =
    deliverables !== undefined &&
    ((deliverables.print_cmyk_images?.length ?? 0) > 0 ||
      (deliverables.lifestyle_mockups?.length ?? 0) > 0 ||
      (deliverables.final_png_images?.length ?? 0) > 0);
  const isProductionActive = isProducing || jobStatus === "producing";
  const hasStage3 = hasDeliverables || isProductionActive;

  return (
    <div className="flex w-full flex-col gap-6 py-2">
      {/* Error Banner */}
      {errorMessage && (
        <div className="flex items-center justify-between rounded-xl border border-rose-800 bg-rose-950/80 p-4 text-xs text-rose-200 shadow-lg">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header Bar */}
      <HeaderBar
        currentStage={currentStage}
        onSelectStage={handleSelectStage}
        authStatus={authStatus}
        isLoggingIn={isLoggingIn}
        onLaunchLogin={() => void handleLaunchLogin()}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        candidateCount={candidates.length}
        isStage2Available={hasStage2}
        isStage3Available={hasStage3}
        isProducing={isProductionActive}
        activeJobId={jobId}
        recentRuns={recentRuns}
        onLoadJob={(targetId) => void handleLoadJob(targetId)}
        onNewJob={handleNewJob}
      />

      {/* TAB 1: Quét Trend & Khởi tạo Job */}
      {currentStage === 1 && (
        <div className="flex flex-col gap-5 animate-in fade-in duration-200">
          {/* Quick link banner if candidate review is already available */}
          {hasStage2 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-amber-500/50 bg-amber-950/40 p-4 text-xs text-amber-200 shadow-md">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">📌</span>
                <div>
                  <p className="font-bold text-amber-300">
                    Đã có {candidates.length} mẫu ứng viên sẵn sàng duyệt trong job này!
                  </p>
                  <p className="text-[11px] text-amber-400/80">
                    Bạn có thể chuyển ngay sang Bước 2 để lọc và chọn mẫu in xưởng.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleSelectStage(2)}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 font-bold text-slate-950 shadow-md transition hover:from-amber-400 hover:to-orange-400 cursor-pointer"
              >
                <span>Chuyển sang Bước 2: Duyệt mẫu</span>
                <span>➔</span>
              </button>
            </div>
          )}

          {/* 2-Columns Layout: Form (Left) & Progress/Logs (Right) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            {/* Left Column: Form Khởi Tạo & Lịch Sử Job */}
            <div className="lg:col-span-6 flex flex-col gap-6">
              <InitForm
                niche={niche}
                onNicheChange={(val) => {
                  setNiche(val);
                  setProduct(inferProductTypeFromNiche(val));
                }}
                crawlCount={crawlCount}
                onCrawlCountChange={setCrawlCount}
                product={product}
                onProductChange={setProduct}
                referenceImages={referenceImages}
                onReferenceImagesChange={setReferenceImages}
                jobStatus={jobStatus}
                onStartCrawl={() => void handleStartCrawl()}
                onStopJob={() => void handleStopJob()}
              />

              <RecentRunsAccordion
                recentRuns={recentRuns}
                activeJobId={jobId}
                onLoadJob={(targetId) => void handleLoadJob(targetId)}
                onDeleteJob={(targetId) => void handleDeleteJob(targetId)}
                isLoading={isLoadingRecent}
                onRefresh={() => void loadRecentRuns()}
                onPreviewThumbnail={handlePreviewThumbnail}
                onReuseNiche={handleReuseNiche}
              />
            </div>

            {/* Right Column: Tiến Độ & Live Logs */}
            <div className="lg:col-span-6 flex flex-col gap-6">
              <ProgressAndLogs
                stepper={stepper}
                logs={logs}
                candidateCount={candidates.length}
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Duyệt Ứng viên (Review) */}
      {currentStage === 2 && (
        <div ref={stage2Ref} className="flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Breadcrumb Context Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-400">
              <button
                type="button"
                onClick={() => handleSelectStage(1)}
                className="flex items-center gap-1 font-semibold text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer"
              >
                <span>←</span>
                <span>Quay lại Bước 1</span>
              </button>
              <span>•</span>
              <span>
                Niche: <strong className="text-slate-100">&ldquo;{niche}&rdquo;</strong>
              </span>
              <span>•</span>
              <span>
                Sản phẩm: <strong className="text-slate-100 uppercase">{product}</strong>
              </span>
              <span>•</span>
              <span>
                Tổng số: <strong className="text-cyan-300">{candidates.length} mẫu</strong>
              </span>
              {jobId && (
                <>
                  <span>•</span>
                  <code className="text-[10px] text-slate-400 font-mono">{jobId}</code>
                </>
              )}
            </div>

            {hasDeliverables && (
              <button
                type="button"
                onClick={() => handleSelectStage(3)}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-700/80 bg-emerald-950/60 px-3 py-1.5 font-semibold text-emerald-300 hover:bg-emerald-900/60 transition shadow-xs cursor-pointer"
              >
                <span>Xem Thành phẩm đã có</span>
                <span>➔</span>
              </button>
            )}
          </div>

          <CandidateReviewGrid
            candidates={candidates}
            selectedIds={selectedCandidateIds}
            onToggleCandidate={handleToggleCandidate}
            onSelectAll={handleSelectAll}
            onSelectDirectPrintableOnly={handleSelectDirectPrintableOnly}
            onDeselectAll={handleDeselectAll}
            onProduce={() => void handleProduce()}
            isProducing={isProducing}
            onPreviewCandidate={handlePreviewCandidate}
            roomTemplates={referenceImages}
            onRemoveRoomTemplate={handleRemoveRoomTemplate}
            onUseCandidateAsRoomTemplate={handleUseCandidateAsRoomTemplate}
            onOpenRoomManager={() => setIsRoomManagerOpen(true)}
          />
        </div>
      )}

      {/* TAB 3: Thành phẩm & Bàn giao */}
      {currentStage === 3 && (
        <div ref={stage3Ref} className="flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Breadcrumb Context Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-400">
              {hasStage2 && (
                <>
                  <button
                    type="button"
                    onClick={() => handleSelectStage(2)}
                    className="flex items-center gap-1 font-semibold text-amber-400 hover:text-amber-300 hover:underline cursor-pointer"
                  >
                    <span>←</span>
                    <span>Xem lại Mẫu ứng viên ({candidates.length})</span>
                  </button>
                  <span>•</span>
                </>
              )}
              <button
                type="button"
                onClick={() => handleSelectStage(1)}
                className="flex items-center gap-1 font-semibold text-slate-400 hover:text-slate-200 hover:underline cursor-pointer"
              >
                <span>Bước 1: Quét Trend</span>
              </button>
              {jobId && (
                <>
                  <span>•</span>
                  <code className="text-[10px] text-slate-400 font-mono">{jobId}</code>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleSelectStage(1)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition shadow-xs cursor-pointer"
            >
              <span>🚀</span>
              <span>Làm đợt mới</span>
            </button>
          </div>

          {/* In-Progress producing banner */}
          {isProductionActive && !hasDeliverables && (
            <div className="flex flex-col gap-4 rounded-xl border border-amber-800/60 bg-amber-950/30 p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 animate-pulse text-xl">
                    🏭
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-amber-200">
                      Đang sản xuất thành phẩm xưởng &amp; Mockup AI...
                    </h2>
                    <p className="text-xs text-amber-300/80">
                      {stepper?.current_message || "Hệ thống đang chuẩn bị file in CMYK 300 DPI và tạo bối cảnh lifestyle..."}
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-amber-600/50 bg-amber-900/50 px-3 py-1 text-xs font-semibold text-amber-300">
                  {stepper?.percent ?? 0}% hoàn tất
                </span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                  style={{ width: `${Math.max(5, stepper?.percent ?? 0)}%` }}
                />
              </div>

              <p className="text-[11px] text-slate-400">
                ⚡ Hệ thống đang xử lý độc lập ở chế độ chuẩn mẫu tham chiếu (Direct Print). Sau khi hoàn thành toàn bộ {selectedCandidateIds.length || candidates.length} sản phẩm, thông báo Windows sẽ tự động kích hoạt.
              </p>
            </div>
          )}

          {/* Failed banner */}
          {jobStatus === "failed" && !hasDeliverables && (
            <div className="flex flex-col gap-3 rounded-xl border border-rose-800 bg-rose-950/70 p-6 shadow-xl text-xs text-rose-200">
              <div className="flex items-center gap-3">
                <span className="text-2xl">❌</span>
                <div>
                  <h3 className="text-sm font-bold text-rose-100">Sản xuất thất bại</h3>
                  <p className="text-rose-300/90 mt-0.5">{errorMessage || "Đã xảy ra lỗi trong quá trình xử lý pipeline."}</p>
                </div>
              </div>
            </div>
          )}

          {/* Completed Deliverables Showcase */}
          {hasDeliverables && (
            <DeliverablesShowcase
              deliverables={deliverables}
              summaryMetrics={summaryMetrics}
              seoPayload={seoPayload}
              onPreviewImage={setPreviewImage}
            />
          )}
        </div>
      )}

      {/* HD Lightbox Zoom Modal */}
      <ImageLightboxModal image={previewImage} onClose={() => setPreviewImage(null)} />

      {/* Room Template Manager Popup Modal */}
      <RoomTemplateManagerModal
        isOpen={isRoomManagerOpen}
        onClose={() => setIsRoomManagerOpen(false)}
        images={referenceImages}
        onChange={setReferenceImages}
        onPreviewImage={handlePreviewThumbnail}
      />

      {/* Pinterest Auth & Token Management Modal */}
      <PinterestAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        authStatus={authStatus}
        onRefreshStatus={refreshAuthStatus}
        client={client}
        isLoggingIn={isLoggingIn}
        onLaunchBrowserLogin={() => void handleLaunchLogin()}
      />
    </div>
  );
}
