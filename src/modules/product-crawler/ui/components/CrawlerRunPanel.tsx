import { useEffect, useRef, useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
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
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
                isRunning
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : isFinished
                    ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                    : status === "failed"
                      ? "bg-rose-50 border-rose-300 text-rose-700"
                      : "bg-amber-50 border-amber-300 text-amber-700"
              }`}
            >
              {isRunning ? (
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-transparent" />
              ) : isFinished ? (
                <span className="text-emerald-700 text-lg font-bold">✓</span>
              ) : status === "failed" ? (
                <span className="text-rose-700 text-lg font-bold">✕</span>
              ) : (
                <span className="text-amber-700 text-lg font-bold">!</span>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Tiến trình cào sản phẩm</h2>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                    status === "completed"
                      ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                      : status === "partial"
                        ? "bg-amber-50 border border-amber-200 text-amber-700"
                        : status === "running"
                          ? "bg-blue-50 border border-blue-200 text-blue-700 animate-pulse"
                          : status === "cancelled"
                            ? "bg-rose-50 border border-rose-200 text-rose-700"
                            : status === "failed"
                              ? "bg-rose-50 border border-rose-200 text-rose-700 font-bold"
                              : "bg-slate-50 text-slate-700"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status === "completed"
                        ? "bg-emerald-700"
                        : status === "partial"
                          ? "bg-amber-700"
                          : status === "running"
                            ? "bg-blue-600"
                            : status === "failed" || status === "cancelled"
                              ? "bg-rose-600"
                              : "bg-slate-200"
                    }`}
                  />
                  {status}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-600 font-mono">
                <span>Mã Job: {jobId}</span>
                <button
                  type="button"
                  onClick={handleCopyJobId}
                  className="text-slate-600 hover:text-blue-700 transition"
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
                className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
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
                    className="rounded-lg bg-blue-50 px-4 py-2 text-xs font-bold text-slate-950 shadow-md transition"
                  >
                    ↻ Thử lại (Retry)
                  </button>
                )}
                {onBackToInput && (
                  <button
                    type="button"
                    onClick={onBackToInput}
                    className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
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
                className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
              >
                ← Quay lại nhập nguồn
              </button>
            )}

            {isFinished && onViewResults && (
              <button
                type="button"
                onClick={onViewResults}
                className="rounded-lg bg-blue-50 px-4 py-2 text-xs font-bold text-slate-950 shadow-md transition"
              >
                Xem kết quả sản phẩm →
              </button>
            )}
          </div>
        </div>

        {/* Failure message banner if failed */}
        {status === "failed" && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700 flex items-start gap-2.5">
            <span className="text-base text-rose-700"><AppIcon name="warning" /></span>
            <div>
              <span className="font-bold text-rose-700 block">Tiến trình cào thất bại</span>
              <span>{errorMessage || "Không thể kết nối đến máy chủ cào hoặc sản phẩm không tồn tại trên Amazon."}</span>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">{currentMessage}</span>
            <span className="font-mono font-bold text-blue-700">{percent}%</span>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white border border-slate-200">
            <div
              className={`h-full transition-all duration-500 ease-out ${
                status === "completed"
                  ? "bg-blue-50 "
                  : status === "partial"
                    ? "bg-blue-50 "
                    : status === "cancelled"
                      ? "bg-slate-100"
                      : status === "failed"
                        ? "bg-rose-600"
                        : "bg-blue-50 "
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
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : isCurrent
                      ? "border-blue-300 bg-blue-50 text-blue-700 shadow-sm "
                      : isFailedStep
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-xs font-bold ${
                      isPassed
                        ? "bg-emerald-700 text-white"
                        : isCurrent
                          ? "bg-blue-600 text-white animate-pulse"
                          : isFailedStep
                            ? "bg-rose-600 text-white"
                            : "bg-slate-50 text-slate-600"
                    }`}
                  >
                    {isPassed ? "✓" : isFailedStep ? "✕" : item.step}
                  </span>
                  <span className="text-xs font-bold truncate">Bước {item.step}</span>
                </div>
                <p className="text-xs font-medium leading-snug line-clamp-2">{item.name}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary Metrics Grid */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-xs text-slate-600 block mb-1">Số mục yêu cầu</span>
            <span className="text-2xl font-bold font-mono text-slate-900">{summary.requestedInputs}</span>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-xs text-slate-600 block mb-1">Sản phẩm tìm thấy</span>
            <span className="text-2xl font-bold font-mono text-blue-700">{summary.productsFound}</span>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-xs text-slate-600 block mb-1">Đã hoàn thành</span>
            <span className="text-2xl font-bold font-mono text-emerald-700">{summary.productsCompleted}</span>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-xs text-slate-600 block mb-1">Lỗi / Thất bại</span>
            <span
              className={`text-2xl font-bold font-mono ${
                summary.productsFailed > 0 ? "text-rose-700" : "text-slate-600"
              }`}
            >
              {summary.productsFailed}
            </span>
          </div>
        </div>
      )}

      {/* Real-time Logs Console */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-700 animate-pulse" />
            <span className="text-xs font-semibold text-slate-900">Nhật ký xử lý (Live Crawler Logs)</span>
            <span className="rounded bg-slate-50 px-1.5 py-0.2 text-xs font-mono text-slate-600">
              {logs.length} dòng
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsLogsExpanded(!isLogsExpanded)}
            className="text-xs text-slate-600 hover:text-slate-900"
          >
            {isLogsExpanded ? "Thu gọn ▲" : "Mở rộng ▼"}
          </button>
        </div>

        {isLogsExpanded && (
          <div className="max-h-64 overflow-y-auto p-4 font-mono text-xs text-slate-700 space-y-1 bg-slate-50 selection:bg-blue-50">
            {logs.length === 0 ? (
              <div className="text-slate-500 italic">Đang chờ nhận bản ghi đầu tiên từ crawler daemon...</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="leading-relaxed hover:bg-slate-50 px-1 rounded">
                  <span className="text-slate-500 mr-2">{String(index + 1).padStart(2, "0")}.</span>
                  <span
                    className={
                      log.includes("Failed") || log.includes("Error")
                        ? "text-rose-700"
                        : log.includes("warning") || log.includes("Warning")
                          ? "text-amber-700"
                          : log.includes("Successfully") || log.includes("finished")
                            ? "text-emerald-700"
                            : "text-slate-700"
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
