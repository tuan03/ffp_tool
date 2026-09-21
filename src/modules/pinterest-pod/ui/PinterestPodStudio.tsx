import { useEffect, useMemo, useRef, useState } from "react";

import { packageDeliverablesForSeo, realPinterestPodClient } from "../service";
import type {
  CandidateItem,
  DeliverablesData,
  JobDetailResponse,
  JobStatus,
  PinterestAuthStatus,
  PinterestPodClient,
  PinterestProductType,
  ReferenceImage,
  StepperState,
  SummaryMetrics,
} from "../types";
import { CandidateReviewGrid } from "./components/CandidateReviewGrid";
import { DeliverablesShowcase } from "./components/DeliverablesShowcase";
import { HeaderBar } from "./components/HeaderBar";
import { InitForm } from "./components/InitForm";
import { ProgressAndLogs } from "./components/ProgressAndLogs";

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

  // Current stage active pill
  const [currentStage, setCurrentStage] = useState<1 | 2 | 3>(1);

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

  // Check auth status on mount
  useEffect(() => {
    isMountedRef.current = true;
    async function loadAuth(): Promise<void> {
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
    }
    void loadAuth();

    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, [client]);

  // Handle Pinterest login launch
  async function handleLaunchLogin(): Promise<void> {
    setIsLoggingIn(true);
    setErrorMessage(null);
    try {
      await client.launchLogin(600);
      if (!isMountedRef.current) return;
      const updatedAuth = await client.getAuthStatus();
      if (!isMountedRef.current) return;
      setAuthStatus(updatedAuth);
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
        setCandidates(detail.candidates);
        // Pre-select recommended candidates by default if none selected yet
        setSelectedCandidateIds((prev) => {
          if (prev.length > 0) return prev;
          return (detail.candidates ?? []).filter((c) => c.recommended).map((c) => c.id);
        });
      }
      if (detail.deliverables) {
        setDeliverables(detail.deliverables);
      }
      if (detail.summaryMetrics || detail.summary_metrics) {
        setSummaryMetrics(detail.summaryMetrics ?? detail.summary_metrics);
      }

      if (detail.status === "ready_for_review") {
        setCurrentStage(2);
        stopPolling();
        setTimeout(() => {
          if (isMountedRef.current) {
            stage2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 150);
      } else if (detail.status === "completed") {
        setCurrentStage(3);
        setIsProducing(false);
        stopPolling();
        setTimeout(() => {
          if (isMountedRef.current) {
            stage3Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 150);
      } else if (detail.status === "failed" || detail.status === "cancelled") {
        setIsProducing(false);
        stopPolling();
        if (detail.error) {
          setErrorMessage(detail.error);
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

    try {
      const created = await client.createJob({
        niche: niche.trim(),
        product,
        workflow_stage: "crawl_and_review",
        candidatePoolSize: 15,
        referenceImages,
      });

      setJobId(created.jobId);
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
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : "Hủy job thất bại");
    }
  }

  // Toggle candidate selection
  function handleToggleCandidate(id: string): void {
    setSelectedCandidateIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function handleSelectAll(): void {
    setSelectedCandidateIds(candidates.map((c) => c.id));
  }

  function handleSelectDirectPrintableOnly(): void {
    setSelectedCandidateIds(
      candidates
        .filter((c) => c.is_direct_printable || c.printability_score > 85)
        .map((c) => c.id),
    );
  }

  function handleDeselectAll(): void {
    setSelectedCandidateIds([]);
  }

  // Produce Action (Stage 2 -> Stage 3)
  async function handleProduce(): Promise<void> {
    if (!jobId || selectedCandidateIds.length === 0) return;

    setIsProducing(true);
    setErrorMessage(null);
    setJobStatus("producing");
    setStepper({
      current_step: 3,
      percent: 60,
      current_message: `Đang sản xuất file in CMYK và render mockup AI cho ${selectedCandidateIds.length} mẫu đã chọn...`,
    });

    try {
      await client.produce({
        jobId,
        selected_candidates: selectedCandidateIds,
      });
      if (!isMountedRef.current) return;

      stopPolling();
      pollingTimerRef.current = setInterval(() => {
        void pollJob(jobId);
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
    if (stage === 1) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (stage === 2 && stage2Ref.current) {
      stage2Ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (stage === 3 && stage3Ref.current) {
      stage3Ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
  const hasStage3 = deliverables !== undefined || jobStatus === "completed";

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
      />

      {/* 2-Columns Layout: Form (Left) & Progress/Logs (Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Form Khởi Tạo */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <InitForm
            niche={niche}
            onNicheChange={setNiche}
            product={product}
            onProductChange={setProduct}
            referenceImages={referenceImages}
            onReferenceImagesChange={setReferenceImages}
            jobStatus={jobStatus}
            onStartCrawl={() => void handleStartCrawl()}
            onStopJob={() => void handleStopJob()}
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

      {/* Stage 2: Candidate Review Grid */}
      {hasStage2 && (
        <div ref={stage2Ref} className="pt-2">
          <CandidateReviewGrid
            candidates={candidates}
            selectedIds={selectedCandidateIds}
            onToggleCandidate={handleToggleCandidate}
            onSelectAll={handleSelectAll}
            onSelectDirectPrintableOnly={handleSelectDirectPrintableOnly}
            onDeselectAll={handleDeselectAll}
            onProduce={() => void handleProduce()}
            isProducing={isProducing}
          />
        </div>
      )}

      {/* Stage 3: Deliverables Showcase */}
      {hasStage3 && deliverables && (
        <div ref={stage3Ref} className="pt-2">
          <DeliverablesShowcase
            deliverables={deliverables}
            summaryMetrics={summaryMetrics}
            seoPayload={seoPayload}
          />
        </div>
      )}
    </div>
  );
}
