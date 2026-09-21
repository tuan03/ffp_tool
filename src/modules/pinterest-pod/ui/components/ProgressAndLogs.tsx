import { useEffect, useRef, useState } from "react";
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
}

export function ProgressAndLogs({
  stepper,
  logs = [],
  candidateCount = 0,
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
    <section className="flex flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      {/* Header & Progress Bar */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <span>📊</span>
            <span>Tiến độ Quy trình POD</span>
          </h2>
          <span className="rounded-full bg-cyan-950 border border-cyan-800 px-2.5 py-0.5 text-xs font-bold text-cyan-300">
            {percent}%
          </span>
        </div>

        {/* Progress Track */}
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 transition-all duration-500 ease-out"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        </div>
      </div>

      {/* Stepper Steps */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
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
                    ? "bg-emerald-500 text-slate-950"
                    : isCurrent
                      ? "bg-cyan-500 text-slate-950 ring-2 ring-cyan-400/40 animate-pulse"
                      : "border border-slate-700 bg-slate-800 text-slate-500"
                }`}
              >
                {isDone ? "✓" : s.step}
              </div>
              <span
                className={`font-medium ${
                  isDone
                    ? "text-slate-300"
                    : isCurrent
                      ? "font-semibold text-cyan-300"
                      : "text-slate-500"
                }`}
              >
                {title}
              </span>
            </div>
          );
        })}

        {/* Current status message */}
        <div className="mt-2 rounded border border-cyan-900/50 bg-cyan-950/40 p-2 text-xs text-cyan-200">
          <span className="font-semibold text-cyan-400">Trạng thái:</span> {message}
        </div>
      </div>

      {/* Live Service Logs Drawer */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3 py-2 text-xs">
          <button
            type="button"
            onClick={() => setIsLogsExpanded(!isLogsExpanded)}
            className="flex items-center gap-1.5 font-semibold text-slate-300 hover:text-white"
          >
            <span>{isLogsExpanded ? "▼" : "▶"}</span>
            <span>Live Service Logs ({logs.length} dòng)</span>
          </button>

          {isLogsExpanded && logs.length > 0 && (
            <button
              type="button"
              onClick={handleCopyLogs}
              className="text-[11px] font-medium text-cyan-400 hover:underline"
            >
              {copied ? "✓ Đã sao chép" : "Sao chép"}
            </button>
          )}
        </div>

        {isLogsExpanded && (
          <div
            ref={logsContainerRef}
            className="max-h-52 min-h-28 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-slate-300"
          >
            {logs.length === 0 ? (
              <p className="italic text-slate-600">Chưa có log từ hệ thống.</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-500 select-none">&gt;</span>
                  <span
                    className={
                      log.includes("Lỗi") || log.includes("failed")
                        ? "text-rose-400"
                        : log.includes("AI Vision") || log.includes("Hoàn thành")
                          ? "text-emerald-300"
                          : "text-slate-300"
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
