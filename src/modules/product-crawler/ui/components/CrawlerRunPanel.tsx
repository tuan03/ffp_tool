import { useEffect, useRef, useState } from "react";

import type {
  ProductCrawlerJobStatus,
  ProductCrawlerStepper,
  ProductCrawlerSummary,
} from "../../types";

interface CrawlerRunPanelProps {
  jobId: string;
  status: ProductCrawlerJobStatus;
  stepper?: ProductCrawlerStepper;
  summary?: ProductCrawlerSummary;
  logs: string[];
  isCancelling: boolean;
  errorMessage?: string | null;
  onCancel(): void;
  onRetry?(): void;
  onBackToInput?(): void;
  onViewResults?(): void;
}

const STEPPER_LABELS = [
  { step: 1, name: "Xác thực danh sách ASIN / URL", desc: "Validate input" },
  { step: 2, name: "Lấy dữ liệu sản phẩm gốc từ Amazon", desc: "Fetch product metadata" },
  { step: 3, name: "Cào danh sách biến thể nguồn", desc: "Crawl source variants" },
  { step: 4, name: "Bóc tách tùy biến & ma trận thuộc tính", desc: "Crawl variants & customization" },
  { step: 5, name: "Tổng hợp và đóng gói sản phẩm", desc: "Finalize products" },
];

export function CrawlerRunPanel({
  jobId,
  status,
  stepper,
  summary,
  logs,
  isCancelling,
  errorMessage,
  onCancel,
  onRetry,
  onBackToInput,
  onViewResults,
}: CrawlerRunPanelProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLogsExpanded) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isLogsExpanded]);

  const handleCopyJobId = (): void => {
    navigator.clipboard.writeText(jobId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentStep = stepper?.currentStep ?? (status === "queued" ? 1 : 2);
  const percent =
    stepper?.percent ??
    (status === "completed" || status === "partial"
      ? 100
      : status === "failed" || status === "cancelled"
        ? 0
        : 25);
  const currentMessage =
    stepper?.currentMessage ??
    (status === "queued"
      ? "Đang xếp hàng chờ xử lý..."
      : status === "running"
        ? "Đang tiến hành cào dữ liệu từ Amazon..."
        : status === "cancelled"
          ? "Phiên cào dữ liệu đã bị hủy."
          : status === "failed"
            ? errorMessage || "Tiến trình cào dữ liệu gặp lỗi thất bại."
            : "Hoàn tất xử lý!");

  const isFinished = status === "completed" || status === "partial";
  const isRunning = status === "running" || status === "queued";

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
                isRunning
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  : isFinished
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : status === "failed"
                      ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-400"
              }`}
            >
              {isRunning ? (
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
              ) : isFinished ? (
                <span className="text-emerald-400 text-lg font-bold">✓</span>
              ) : status === "failed" ? (
                <span className="text-rose-400 text-lg font-bold">✕</span>
              ) : (
                <span className="text-amber-400 text-lg font-bold">!</span>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">Tiến trình cào sản phẩm</h2>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                    status === "completed"
                      ? "bg-emerald-950/70 border border-emerald-800 text-emerald-300"
                      : status === "partial"
                        ? "bg-amber-950/70 border border-amber-800 text-amber-300"
                        : status === "running"
                          ? "bg-cyan-950/70 border border-cyan-800 text-cyan-300 animate-pulse"
                          : status === "cancelled"
                            ? "bg-rose-950/70 border border-rose-800 text-rose-300"
                            : status === "failed"
                              ? "bg-rose-950/70 border border-rose-700 text-rose-300 font-bold"
                              : "bg-slate-800 text-slate-300"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status === "completed"
                        ? "bg-emerald-400"
                        : status === "partial"
                          ? "bg-amber-400"
                          : status === "running"
                            ? "bg-cyan-400"
                            : status === "failed" || status === "cancelled"
                              ? "bg-rose-400"
                              : "bg-slate-400"
                    }`}
                  />
                  {status}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 font-mono">
                <span>Mã Job: {jobId}</span>
                <button
                  type="button"
                  onClick={handleCopyJobId}
                  className="text-slate-400 hover:text-cyan-400 transition"
                  title="Sao chép Job ID"
                >
                  {copied ? "✓ Đã sao chép" : "📋"}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isRunning && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isCancelling}
                className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-3.5 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-900/60 hover:text-rose-100 disabled:opacity-50"
              >
                {isCancelling ? "Đang hủy..." : "✕ Hủy tiến trình (Cancel)"}
              </button>
            )}

            {status === "failed" && (
              <div className="flex items-center gap-2">
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-xs font-bold text-slate-950 shadow-md shadow-amber-500/20 hover:from-amber-400 hover:to-orange-500 transition"
                  >
                    ↻ Thử lại (Retry)
                  </button>
                )}
                {onBackToInput && (
                  <button
                    type="button"
                    onClick={onBackToInput}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                  >
                    ← Quay lại nhập nguồn
                  </button>
                )}
              </div>
            )}

            {status === "cancelled" && onBackToInput && (
              <button
                type="button"
                onClick={onBackToInput}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
              >
                ← Quay lại nhập nguồn
              </button>
            )}

            {isFinished && onViewResults && (
              <button
                type="button"
                onClick={onViewResults}
                className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-xs font-bold text-slate-950 shadow-md shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500 transition"
              >
                Xem kết quả sản phẩm →
              </button>
            )}
          </div>
        </div>

        {/* Failure message banner if failed */}
        {status === "failed" && (
          <div className="mt-4 rounded-lg border border-rose-800/80 bg-rose-950/40 p-3.5 text-xs text-rose-200 flex items-start gap-2.5">
            <span className="text-base text-rose-400">⚠️</span>
            <div>
              <span className="font-bold text-rose-300 block">Tiến trình cào thất bại</span>
              <span>{errorMessage || "Không thể kết nối đến máy chủ cào hoặc sản phẩm không tồn tại trên Amazon."}</span>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300">{currentMessage}</span>
            <span className="font-mono font-bold text-cyan-400">{percent}%</span>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-950 border border-slate-800">
            <div
              className={`h-full transition-all duration-500 ease-out ${
                status === "completed"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                  : status === "partial"
                    ? "bg-gradient-to-r from-amber-500 to-emerald-400"
                    : status === "cancelled"
                      ? "bg-slate-600"
                      : status === "failed"
                        ? "bg-rose-500"
                        : "bg-gradient-to-r from-cyan-500 to-blue-500"
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* 5-step Stepper list */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-5 gap-2">
          {STEPPER_LABELS.map((item) => {
            const isPassed = (currentStep > item.step || isFinished) && status !== "failed";
            const isCurrent = currentStep === item.step && isRunning;
            const isFailedStep = currentStep === item.step && status === "failed";

            return (
              <div
                key={item.step}
                className={`rounded-lg border p-2.5 transition ${
                  isPassed
                    ? "border-emerald-800/60 bg-emerald-950/20 text-emerald-300"
                    : isCurrent
                      ? "border-cyan-500 bg-cyan-950/40 text-cyan-200 shadow-sm shadow-cyan-500/20"
                      : isFailedStep
                        ? "border-rose-700 bg-rose-950/30 text-rose-300"
                        : "border-slate-800 bg-slate-950/40 text-slate-500"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                      isPassed
                        ? "bg-emerald-500 text-slate-950"
                        : isCurrent
                          ? "bg-cyan-500 text-slate-950 animate-pulse"
                          : isFailedStep
                            ? "bg-rose-500 text-white"
                            : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {isPassed ? "✓" : isFailedStep ? "✕" : item.step}
                  </span>
                  <span className="text-[11px] font-bold truncate">Bước {item.step}</span>
                </div>
                <p className="text-[11px] font-medium leading-snug line-clamp-2">{item.name}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary Metrics Grid */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <span className="text-xs text-slate-400 block mb-1">Số mục yêu cầu</span>
            <span className="text-2xl font-bold font-mono text-slate-100">{summary.requestedInputs}</span>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <span className="text-xs text-slate-400 block mb-1">Sản phẩm tìm thấy</span>
            <span className="text-2xl font-bold font-mono text-cyan-400">{summary.productsFound}</span>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <span className="text-xs text-slate-400 block mb-1">Đã hoàn thành</span>
            <span className="text-2xl font-bold font-mono text-emerald-400">{summary.productsCompleted}</span>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <span className="text-xs text-slate-400 block mb-1">Lỗi / Thất bại</span>
            <span
              className={`text-2xl font-bold font-mono ${
                summary.productsFailed > 0 ? "text-rose-400" : "text-slate-400"
              }`}
            >
              {summary.productsFailed}
            </span>
          </div>
        </div>
      )}

      {/* Real-time Logs Console */}
      <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-slate-200">Nhật ký xử lý (Live Crawler Logs)</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] font-mono text-slate-400">
              {logs.length} dòng
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsLogsExpanded(!isLogsExpanded)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            {isLogsExpanded ? "Thu gọn ▲" : "Mở rộng ▼"}
          </button>
        </div>

        {isLogsExpanded && (
          <div className="max-h-64 overflow-y-auto p-4 font-mono text-xs text-slate-300 space-y-1 bg-slate-950/90 selection:bg-cyan-900">
            {logs.length === 0 ? (
              <div className="text-slate-600 italic">Đang chờ nhận bản ghi đầu tiên từ crawler daemon...</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="leading-relaxed hover:bg-slate-900/50 px-1 rounded">
                  <span className="text-slate-500 mr-2">{String(index + 1).padStart(2, "0")}.</span>
                  <span
                    className={
                      log.includes("Failed") || log.includes("Error")
                        ? "text-rose-400"
                        : log.includes("warning") || log.includes("Warning")
                          ? "text-amber-300"
                          : log.includes("Successfully") || log.includes("finished")
                            ? "text-emerald-300"
                            : "text-slate-300"
                    }
                  >
                    {log}
                  </span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
