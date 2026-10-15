import { useEffect, useRef, useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type {
  DeliverablesData,
  JobStatus,
  PinterestPodDeliverables,
  PinterestPodShopifySettings,
  StepperState,
  SummaryMetrics,
} from "../../types";

import { DeliverablesShowcase } from "./DeliverablesShowcase";
import type { LightboxImageItem } from "./ImageLightboxModal";
import { ShopifyPricingConfigSection } from "./ShopifyPricingConfigSection";

export interface ProductionStepProps {
  readonly jobId: string | null;
  readonly jobStatus: JobStatus;
  readonly isProductionActive: boolean;
  readonly isCancelling?: boolean;
  readonly stepper?: StepperState;
  readonly logs?: readonly string[];
  readonly deliverables?: DeliverablesData;
  readonly summaryMetrics?: SummaryMetrics;
  readonly seoPayload?: PinterestPodDeliverables;
  readonly shopifySettings: PinterestPodShopifySettings;
  readonly errorMessage: string | null;
  readonly candidateCount: number;
  readonly hasStage2: boolean;
  readonly onSelectStage: (stage: 1 | 2 | 3) => void;
  readonly onCancelJob: () => Promise<void> | void;
  readonly onRerun: () => Promise<void> | void;
  readonly onPreviewImage?: (item: LightboxImageItem) => void;
  readonly onHandoverToSeo?: (payload: PinterestPodDeliverables) => Promise<void>;
  readonly onShopifySettingsChange: (settings: PinterestPodShopifySettings) => void;
  readonly onResetShopifySettings?: () => void;
}

function getLogLineClass(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("lỗi") || lower.includes("error") || lower.includes("thất bại") || lower.includes("rejected")) {
    return "text-rose-700 font-semibold";
  }
  if (lower.includes("dừng") || lower.includes("hủy") || lower.includes("cancel") || lower.includes("cảnh báo") || lower.includes("warning")) {
    return "text-amber-700 font-medium";
  }
  if (lower.includes("hoàn thành") || lower.includes("hoàn tất") || lower.includes("completed") || lower.includes("thành công") || lower.includes("success")) {
    return "text-emerald-700 font-medium";
  }
  if (lower.includes("ai vision") || lower.includes("gemini") || lower.includes("cmyk") || lower.includes("mockup") || lower.includes("direct print")) {
    return "text-blue-700";
  }
  return "text-slate-700";
}

export function ProductionStep({
  jobId,
  jobStatus,
  isProductionActive,
  isCancelling = false,
  stepper,
  logs = [],
  deliverables,
  summaryMetrics,
  seoPayload,
  shopifySettings,
  errorMessage,
  candidateCount,
  hasStage2,
  onSelectStage,
  onCancelJob,
  onRerun,
  onPreviewImage,
  onHandoverToSeo,
  onShopifySettingsChange,
  onResetShopifySettings,
}: ProductionStepProps): React.JSX.Element {
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  const hasDeliverables =
    deliverables !== undefined &&
    ((deliverables.print_cmyk_images?.length ?? 0) > 0 ||
      (deliverables.lifestyle_mockups?.length ?? 0) > 0 ||
      (deliverables.final_png_images?.length ?? 0) > 0);

  // Auto-scroll logs to bottom as they arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleCopyLogs(): void {
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(logs.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = logs.join("\n");
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Ignore clipboard failure in unsupported contexts
      }
    }
  }

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-200">
      {/* Breadcrumb Context Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-slate-600">
          {hasStage2 && (
            <>
              <button
                type="button"
                onClick={() => onSelectStage(2)}
                className="flex items-center gap-1 font-semibold text-amber-700 hover:text-amber-700 hover:underline cursor-pointer"
              >
                <span>←</span>
                <span>Xem lại Mẫu ứng viên ({candidateCount})</span>
              </button>
              <span>•</span>
            </>
          )}
          <button
            type="button"
            onClick={() => onSelectStage(1)}
            className="flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900 hover:underline cursor-pointer"
          >
            <span>Bước 1: Quét Trend</span>
          </button>
          {jobId && (
            <>
              <span>•</span>
              <code className="text-xs text-slate-600 font-mono">{jobId}</code>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => onSelectStage(1)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold text-slate-900 hover:bg-slate-100 hover:text-slate-900 transition shadow-xs cursor-pointer"
        >
          <span><AppIcon name="play" /></span>
          <span>Làm đợt mới</span>
        </button>
      </div>

      {/* In-Progress Producing Banner with Cancel Action */}
      {isProductionActive && (
        <div className="flex flex-col gap-4 rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-50 text-amber-700 animate-pulse text-2xl">
                🏭
              </div>
              <div>
                <h2 className="text-base font-bold text-amber-700 flex items-center gap-2">
                  <span>Đang sản xuất thành phẩm xưởng &amp; Mockup AI...</span>
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-700 animate-ping" />
                </h2>
                <p className="text-xs text-amber-700 mt-0.5">
                  {stepper?.current_message || "Hệ thống đang chuẩn bị file in CMYK 300 DPI và tạo bối cảnh lifestyle..."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                {stepper?.percent ?? 0}% hoàn tất
              </span>

              {/* Responsive Cancel Button */}
              <button
                type="button"
                onClick={() => void onCancelJob()}
                disabled={isCancelling}
                className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-1.5 font-semibold text-rose-700 hover:bg-rose-50 hover:text-slate-900 transition shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed text-xs"
                title="Dừng tiến trình sản xuất đang chạy"
              >
                {isCancelling ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-rose-300 border-t-transparent" />
                    <span>Đang dừng...</span>
                  </>
                ) : (
                  <>
                    <span>⏹️</span>
                    <span>Dừng tiến trình</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-50">
            <div
              className="h-full bg-blue-50 transition-all duration-500"
              style={{ width: `${Math.max(5, stepper?.percent ?? 0)}%` }}
            />
          </div>

          <p className="text-xs text-slate-600">
            <AppIcon name="seo" /> Hệ thống đang xử lý độc lập ở chế độ chuẩn mẫu tham chiếu (Direct Print). Sau khi hoàn thành toàn bộ {candidateCount} sản phẩm, thông báo Windows sẽ tự động kích hoạt.
          </p>
        </div>
      )}

      {/* Cancelled Banner */}
      {jobStatus === "cancelled" && (
        <div className="flex flex-col gap-4 rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm text-xs text-amber-700">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">⏹️</span>
              <div>
                <h3 className="text-sm font-bold text-amber-700">Tiến trình đã được dừng an toàn</h3>
                <p className="text-amber-700 mt-0.5">
                  Tiến trình sản xuất đã dừng theo yêu cầu của bạn. Trạng thái và dữ liệu đã được lưu an toàn.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onRerun()}
                className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-1.5 font-semibold text-slate-900 hover:bg-amber-50 transition shadow-xs cursor-pointer"
              >
                <span><AppIcon name="refresh" /></span>
                <span>Thử lại sản xuất</span>
              </button>
              {hasStage2 && (
                <button
                  type="button"
                  onClick={() => onSelectStage(2)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold text-slate-900 hover:bg-slate-100 hover:text-slate-900 transition shadow-xs cursor-pointer"
                >
                  <span><AppIcon name="edit" /></span>
                  <span>Chỉnh sửa mẫu chọn</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Failed Banner */}
      {jobStatus === "failed" && (
        <div className="flex flex-col gap-4 rounded-lg border border-rose-200 bg-rose-50 p-6 shadow-sm text-xs text-rose-700">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl"><AppIcon name="close" /></span>
              <div>
                <h3 className="text-sm font-bold text-rose-700">Sản xuất thất bại</h3>
                <p className="text-rose-700 mt-0.5">{errorMessage || "Đã xảy ra lỗi trong quá trình xử lý pipeline."}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onRerun()}
                className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-1.5 font-semibold text-slate-900 hover:bg-rose-50 transition shadow-xs cursor-pointer"
              >
                <span><AppIcon name="refresh" /></span>
                <span>Thử lại</span>
              </button>
              {hasStage2 && (
                <button
                  type="button"
                  onClick={() => onSelectStage(2)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold text-slate-900 hover:bg-slate-100 hover:text-slate-900 transition shadow-xs cursor-pointer"
                >
                  <span>←</span>
                  <span>Quay lại duyệt mẫu</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Live Execution Logs Viewer (Always available in Stage 3, collapsible) */}
      <section className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsLogsExpanded((prev) => !prev)}
              className="flex items-center gap-2 font-semibold text-slate-900 hover:text-slate-900 cursor-pointer"
            >
              <span className="text-slate-600">{isLogsExpanded ? "▼" : "▶"}</span>
              <span>Live Execution Logs</span>
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                {logs.length} dòng
              </span>
            </button>

            {isProductionActive && (
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-700 animate-pulse" />
                Live streaming
              </span>
            )}
            {jobStatus === "cancelled" && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                Đã dừng
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {isLogsExpanded && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded border-slate-300 bg-slate-50 text-blue-700 focus:ring-0"
                />
                <span>Cuộn tự động</span>
              </label>
            )}

            {logs.length > 0 && (
              <button
                type="button"
                onClick={handleCopyLogs}
                className="text-xs font-medium text-blue-700 hover:text-blue-700 hover:underline cursor-pointer"
              >
                {copied ? "✓ Đã sao chép" : "Sao chép"}
              </button>
            )}
          </div>
        </div>

        {isLogsExpanded && (
          <div
            ref={logsContainerRef}
            className="max-h-60 min-h-28 overflow-y-auto p-3.5 font-mono text-xs leading-relaxed text-slate-700 bg-slate-50 select-text"
          >
            {logs.length === 0 ? (
              <p className="italic text-slate-500">Chưa có log từ hệ thống.</p>
            ) : (
              logs.map((log, i) => (
                <div key={`${i}-${log.slice(0, 30)}`} className="flex gap-2 py-0.5">
                  <span className="text-slate-500 select-none text-xs w-6 shrink-0 text-right">
                    {i + 1}
                  </span>
                  <span className="text-slate-500 select-none">&gt;</span>
                  <span className={`break-words whitespace-pre-wrap ${getLogLineClass(log)}`}>
                    {log}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* Completed Deliverables Showcase */}
      {hasDeliverables && (
        <DeliverablesShowcase
          deliverables={deliverables}
          summaryMetrics={summaryMetrics}
          seoPayload={seoPayload}
          jobId={jobId}
          onPreviewImage={onPreviewImage}
          onHandoverToSeo={onHandoverToSeo}
        />
      )}

      {/* Missing deliverables alert when job finished or completed without items */}
      {!hasDeliverables && !isProductionActive && jobStatus !== "cancelled" && jobStatus !== "failed" && (
        <div className="flex flex-col gap-4 rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm text-xs text-amber-700">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl"><AppIcon name="warning" /></span>
              <div>
                <h3 className="text-sm font-bold text-amber-700">Chưa có ảnh thành phẩm cho tác vụ này</h3>
                <p className="text-amber-700 mt-0.5">
                  Hệ thống chưa tạo được bộ mockup hoặc file in cho các mẫu đã chọn (có thể do đường dẫn ảnh gốc bị gián đoạn hoặc chưa nạp được ảnh hợp lệ).
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onRerun()}
                className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-1.5 font-semibold text-slate-900 hover:bg-amber-50 transition shadow-xs cursor-pointer"
              >
                <span><AppIcon name="refresh" /></span>
                <span>Thử lại sản xuất</span>
              </button>
              {hasStage2 && (
                <button
                  type="button"
                  onClick={() => onSelectStage(2)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold text-slate-900 hover:bg-slate-100 hover:text-slate-900 transition shadow-xs cursor-pointer"
                >
                  <span>←</span>
                  <span>Quay lại duyệt mẫu</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cấu hình Shopify & Định giá trước khi bàn giao SEO */}
      <ShopifyPricingConfigSection
        settings={shopifySettings}
        onChange={onShopifySettingsChange}
        onReset={onResetShopifySettings}
        disabled={isProductionActive}
      />
    </div>
  );
}
