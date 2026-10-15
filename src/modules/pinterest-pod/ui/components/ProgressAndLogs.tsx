import { useEffect, useRef, useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { StepperState } from "../../types";

const WORKFLOW_STEPS = [
  { step: 1, title: "1. Pinterest Trends: Quét từ khóa hot" },
  { step: 2, title: "2. Candidate Review: Chờ duyệt mẫu" },
  { step: 3, title: "3. CMYK 300DPI: Chuẩn bị file in" },
  { step: 4, title: "4. AI Mockup: Tạo bối cảnh sống động" },
] as const;

interface ProgressAndLogsProps {
  readonly stepper?: StepperState;
  readonly logs?: readonly string[];
  readonly candidateCount?: number;
  readonly agentName?: string;
  readonly jobId?: string | null;
}

export function ProgressAndLogs({
  stepper,
  logs = [],
  candidateCount = 0,
  agentName,
  jobId,
}: ProgressAndLogsProps): React.JSX.Element {
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  const currentStep = stepper?.current_step ?? 1;
  const percent = stepper?.percent ?? 0;
  const message = stepper?.current_message ?? "Hệ thống sẵn sàng khởi tạo quy trình.";

  // Auto-scroll to bottom of logs when new logs arrive
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  function handleCopyLogs(): void {
    void navigator.clipboard.writeText(logs.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm">
      {/* Header & Progress Bar */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span><AppIcon name="chart" /></span>
            <span>Tiến độ Quy trình POD</span>
          </h2>
          <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-bold text-blue-700">
            {percent}%
          </span>
        </div>

        {(agentName || jobId) && (
          <div className="flex flex-wrap gap-2 text-[10px]">
            {agentName && (
              <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                Máy thực thi: {agentName}
              </span>
            )}
            {jobId && (
              <span className="rounded-full bg-slate-50 px-2 py-1 font-mono text-slate-600">Job: {jobId}</span>
            )}
          </div>
        )}

        {/* Progress Track */}
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-50">
          <div
            className="h-full bg-blue-50 transition-all duration-500 ease-out"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        </div>
      </div>

      {/* Stepper Steps */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
        {WORKFLOW_STEPS.map((s) => {
          const isDone = currentStep > s.step || (currentStep === 4 && percent === 100);
          const isCurrent = currentStep === s.step && percent < 100;
          const isPending = currentStep < s.step;

          const title =
            s.step === 2 && candidateCount > 0
              ? `2. Candidate Review: Chờ duyệt ${candidateCount} mẫu`
              : s.title;

          return (
            <div key={s.step} className="flex items-center gap-3 text-xs">
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  isDone
                    ? "bg-emerald-700 text-white"
                    : isCurrent
                      ? "bg-blue-600 text-white ring-2 ring-blue-300 animate-pulse"
                      : "border border-slate-300 bg-slate-50 text-slate-500"
                }`}
              >
                {isDone ? "✓" : s.step}
              </div>
              <span
                className={`font-medium ${
                  isDone
                    ? "text-slate-700"
                    : isCurrent
                      ? "font-semibold text-blue-700"
                      : "text-slate-500"
                }`}
              >
                {title}
              </span>
            </div>
          );
        })}

        {/* Current status message */}
        <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700">
          <span className="font-semibold text-blue-700">Trạng thái:</span> {message}
        </div>
      </div>

      {/* Live Service Logs Drawer */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <button
            type="button"
            onClick={() => setIsLogsExpanded(!isLogsExpanded)}
            className="flex items-center gap-1.5 font-semibold text-slate-700 hover:text-slate-900"
          >
            <span>{isLogsExpanded ? "▼" : "▶"}</span>
            <span>Live Service Logs ({logs.length} dòng)</span>
          </button>

          {isLogsExpanded && logs.length > 0 && (
            <button
              type="button"
              onClick={handleCopyLogs}
              className="text-[11px] font-medium text-blue-700 hover:underline"
            >
              {copied ? "✓ Đã sao chép" : "Sao chép"}
            </button>
          )}
        </div>

        {isLogsExpanded && (
          <div
            ref={logsContainerRef}
            className="max-h-52 min-h-28 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-slate-700"
          >
            {logs.length === 0 ? (
              <p className="italic text-slate-500">Chưa có log từ hệ thống.</p>
            ) : (
              logs.map((log, i) => (
                <div key={`${i}-${log.slice(0, 30)}`} className="flex gap-2">
                  <span className="text-slate-500 select-none">&gt;</span>
                  <span
                    className={
                      log.includes("Lỗi") || log.includes("failed")
                        ? "text-rose-700"
                        : log.includes("AI Vision") || log.includes("Hoàn thành")
                          ? "text-emerald-700"
                          : "text-slate-700"
                    }
                  >
                    {log}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
