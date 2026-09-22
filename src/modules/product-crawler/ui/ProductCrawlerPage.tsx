import { useEffect, useRef, useState } from "react";

import { environment } from "../../../config/environment";
import { getProductCrawlerClient } from "../runtime";
import type {
  CrawlerError,
  CrawlerProduct,
  ProductCrawlerClient,
  ProductCrawlerJobInput,
  ProductCrawlerJobStatus,
  ProductCrawlerStepper,
  ProductCrawlerSummary,
} from "../types";
import { CrawlInputForm } from "./components/CrawlInputForm";
import { CrawlerHandoffModal } from "./components/CrawlerHandoffModal";
import { CrawlerProductDetailModal } from "./components/CrawlerProductDetailModal";
import { CrawlerProductTable } from "./components/CrawlerProductTable";
import { CrawlerRunPanel } from "./components/CrawlerRunPanel";

interface ProductCrawlerPageProps {
  client?: ProductCrawlerClient;
}

type CrawlerStage = 1 | 2 | 3;

export function ProductCrawlerPage({ client }: ProductCrawlerPageProps): React.JSX.Element {
  const crawlerClient = client ?? getProductCrawlerClient(environment);

  const [activeStage, setActiveStage] = useState<CrawlerStage>(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<ProductCrawlerJobStatus>("idle");
  const [stepper, setStepper] = useState<ProductCrawlerStepper | undefined>(undefined);
  const [summary, setSummary] = useState<ProductCrawlerSummary | undefined>(undefined);
  const [logs, setLogs] = useState<string[]>([]);
  const [products, setProducts] = useState<CrawlerProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [jobErrors, setJobErrors] = useState<CrawlerError[]>([]);
  const [jobWarnings, setJobWarnings] = useState<string[]>([]);

  const [selectedDetailProduct, setSelectedDetailProduct] = useState<CrawlerProduct | null>(null);
  const [isHandoffOpen, setIsHandoffOpen] = useState(false);
  const [isStartingJob, setIsStartingJob] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Polling and transition timers ref to prevent race conditions
  const pollTimerRef = useRef<number | null>(null);
  const stageTransitionTimerRef = useRef<number | null>(null);

  // Clear polling and timers on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
      if (stageTransitionTimerRef.current !== null) {
        window.clearTimeout(stageTransitionTimerRef.current);
      }
    };
  }, []);

  // Polling loop when job is active
  useEffect(() => {
    if (!jobId) {
      return;
    }

    if (jobStatus !== "queued" && jobStatus !== "running") {
      return;
    }

    const poll = async (): Promise<void> => {
      try {
        const response = await crawlerClient.getJob(jobId);
        setJobStatus(response.status);
        if (response.stepper) {
          setStepper(response.stepper);
        }
        if (response.summary) {
          setSummary(response.summary);
        }
        if (response.logs) {
          setLogs(response.logs);
        }

        if (response.status === "completed" || response.status === "partial") {
          if (response.output?.products && response.output.products.length > 0) {
            setProducts(response.output.products);
            // Default select all products
            setSelectedProductIds(response.output.products.map((p) => p.id));
          }
          if (response.output?.errors) {
            setJobErrors(response.output.errors);
          }
          if (response.output?.warnings) {
            setJobWarnings(response.output.warnings);
          }
          // Automatically transition to Stage 3 Results after a short pause
          stageTransitionTimerRef.current = window.setTimeout(() => {
            setActiveStage(3);
            stageTransitionTimerRef.current = null;
          }, 800);
          return;
        }

        if (response.status === "failed") {
          if (response.error) {
            setErrorMessage(response.error);
          }
          return;
        }

        if (response.status === "cancelled") {
          return;
        }

        // Schedule next poll in 1500ms
        pollTimerRef.current = window.setTimeout(poll, 1500);
      } catch (err) {
        setErrorMessage((err as Error).message || "Lỗi khi lấy tiến trình crawl");
      }
    };

    pollTimerRef.current = window.setTimeout(poll, 1200);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, [jobId, jobStatus, crawlerClient]);

  const handleStartCrawl = async (input: ProductCrawlerJobInput): Promise<void> => {
    setIsStartingJob(true);
    setErrorMessage(null);
    try {
      const response = await crawlerClient.startJob(input);
      setJobId(response.jobId);
      setJobStatus(response.status);
      setProducts([]);
      setSelectedProductIds([]);
      setJobErrors([]);
      setJobWarnings([]);
      setLogs([
        `[${new Date().toLocaleTimeString()}] Bắt đầu phiên crawl ${response.jobId} (chế độ ${input.crawlMode}).`,
      ]);
      setActiveStage(2);
    } catch (err) {
      setErrorMessage((err as Error).message || "Không thể tạo phiên cào dữ liệu.");
    } finally {
      setIsStartingJob(false);
    }
  };

  const handleRetryJob = async (failedItemIds?: string[]): Promise<void> => {
    if (!jobId) return;
    setIsStartingJob(true);
    setErrorMessage(null);
    try {
      const response = await crawlerClient.retryJob(jobId, failedItemIds);
      setJobId(response.jobId);
      setJobStatus(response.status);
      setJobErrors([]);
      setJobWarnings([]);
      setLogs([
        `[${new Date().toLocaleTimeString()}] Bắt đầu phiên crawl lại ${response.jobId}.`,
      ]);
      setActiveStage(2);
    } catch (err) {
      setErrorMessage((err as Error).message || "Không thể thử lại phiên cào.");
    } finally {
      setIsStartingJob(false);
    }
  };

  const handleCancelJob = async (): Promise<void> => {
    if (!jobId) return;
    setIsCancelling(true);
    try {
      await crawlerClient.cancelJob(jobId);
      setJobStatus("cancelled");
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Người dùng đã dừng tiến trình cào dữ liệu.`,
      ]);
    } catch (err) {
      setErrorMessage((err as Error).message || "Không thể hủy job.");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleResetNewJob = (): void => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (stageTransitionTimerRef.current !== null) {
      window.clearTimeout(stageTransitionTimerRef.current);
      stageTransitionTimerRef.current = null;
    }
    setJobId(null);
    setJobStatus("idle");
    setStepper(undefined);
    setSummary(undefined);
    setLogs([]);
    setProducts([]);
    setSelectedProductIds([]);
    setJobErrors([]);
    setJobWarnings([]);
    setErrorMessage(null);
    setActiveStage(1);
  };

  const handleToggleSelectProduct = (id: string): void => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleToggleSelectAll = (filteredIds: string[]): void => {
    const isAllSelected = filteredIds.every((id) => selectedProductIds.includes(id));
    if (isAllSelected) {
      setSelectedProductIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      const newSet = new Set([...selectedProductIds, ...filteredIds]);
      setSelectedProductIds(Array.from(newSet));
    }
  };

  const handleClearSelection = (): void => {
    setSelectedProductIds([]);
  };

  const selectedProducts = products.filter((p) => selectedProductIds.includes(p.id));

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Title Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <span>Shopify FFP Tool</span>
            <span>/</span>
            <span className="text-cyan-400">Product Crawler</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-100 flex items-center gap-2.5 mt-1">
            <span>🛒</span>
            <span>Amazon Product Crawler</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Thu thập thông tin sản phẩm, ma trận biến thể và cấu hình tùy biến từ Amazon chuẩn hóa cho pipeline tiếp theo.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {jobId && (
            <button
              type="button"
              onClick={handleResetNewJob}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition"
            >
              + Tạo phiên cào mới
            </button>
          )}

          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs">
            <span className="text-slate-400">Nguồn:</span>
            <span className="font-semibold text-amber-400">Amazon US</span>
          </div>
        </div>
      </div>

      {/* Global Error Banner */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-xs text-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-rose-100 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3-Stage Progress Step Indicator */}
      <div className="flex rounded-xl border border-slate-800 bg-slate-900/60 p-1.5 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveStage(1)}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 transition ${
            activeStage === 1
              ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px]">1</span>
          <span>Nhập nguồn (Input)</span>
        </button>

        <button
          type="button"
          disabled={!jobId}
          onClick={() => setActiveStage(2)}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 transition disabled:opacity-40 disabled:cursor-not-allowed ${
            activeStage === 2
              ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px]">2</span>
          <span>Đang cào (Running)</span>
          {jobStatus === "running" && <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />}
        </button>

        <button
          type="button"
          disabled={products.length === 0}
          onClick={() => setActiveStage(3)}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 transition disabled:opacity-40 disabled:cursor-not-allowed ${
            activeStage === 3
              ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px]">3</span>
          <span>Kết quả & Bàn giao ({products.length})</span>
          {products.length > 0 && <span className="text-[10px] text-emerald-400 font-bold">✓</span>}
        </button>
      </div>

      {/* STAGE 1: INPUT */}
      {activeStage === 1 && (
        <CrawlInputForm isLoading={isStartingJob} onSubmit={handleStartCrawl} />
      )}

      {/* STAGE 2: RUNNING / PROGRESS */}
      {activeStage === 2 && jobId && (
        <CrawlerRunPanel
          jobId={jobId}
          status={jobStatus}
          stepper={stepper}
          summary={summary}
          logs={logs}
          isCancelling={isCancelling}
          errorMessage={errorMessage}
          onCancel={handleCancelJob}
          onRetry={() => handleRetryJob()}
          onBackToInput={() => setActiveStage(1)}
          onViewResults={products.length > 0 ? () => setActiveStage(3) : undefined}
        />
      )}

      {/* STAGE 3: RESULTS & REVIEW & HANDOFF */}
      {activeStage === 3 && (
        <div className="space-y-6">
          <CrawlerProductTable
            products={products}
            selectedIds={selectedProductIds}
            jobErrors={jobErrors}
            jobWarnings={jobWarnings}
            onRetryFailed={(failedIds) => handleRetryJob(failedIds)}
            onToggleSelect={handleToggleSelectProduct}
            onToggleSelectAll={handleToggleSelectAll}
            onClearSelection={handleClearSelection}
            onViewDetail={(p) => setSelectedDetailProduct(p)}
            onOpenHandoff={() => setIsHandoffOpen(true)}
          />
        </div>
      )}

      {/* Product Detail Modal */}
      <CrawlerProductDetailModal
        product={selectedDetailProduct}
        onClose={() => setSelectedDetailProduct(null)}
      />

      {/* Handoff Modal */}
      {isHandoffOpen && (
        <CrawlerHandoffModal
          products={selectedProducts}
          onClose={() => setIsHandoffOpen(false)}
        />
      )}
    </div>
  );
}
