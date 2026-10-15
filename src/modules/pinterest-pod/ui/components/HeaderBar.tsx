import { useEffect, useMemo, useRef, useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { PinterestAuthStatus, PodRecentRunItem } from "../../types";

interface HeaderBarProps {
  readonly currentStage: 1 | 2 | 3;
  readonly onSelectStage?: (stage: 1 | 2 | 3) => void;
  readonly authStatus: PinterestAuthStatus | null;
  readonly isLoggingIn: boolean;
  readonly onLaunchLogin: () => void;
  readonly onOpenAuthModal?: () => void;
  readonly candidateCount?: number;
  readonly isStage2Available?: boolean;
  readonly isStage3Available?: boolean;
  readonly isProducing?: boolean;
  readonly activeJobId?: string | null;
  readonly recentRuns?: readonly PodRecentRunItem[];
  readonly onLoadJob?: (jobId: string) => void;
  readonly onNewJob?: () => void;
  readonly isAgentConnected?: boolean;
  readonly agentName?: string;
  readonly isAgentBrowserLoggedIn?: boolean;
  readonly onOpenAgentInstall?: () => void;
}

export function HeaderBar({
  currentStage,
  onSelectStage,
  authStatus,
  isLoggingIn,
  onLaunchLogin,
  onOpenAuthModal,
  candidateCount = 0,
  isStage2Available = false,
  isStage3Available = false,
  isProducing = false,
  activeJobId,
  recentRuns = [],
  onLoadJob,
  onNewJob,
  isAgentConnected = false,
  agentName,
  isAgentBrowserLoggedIn = false,
  onOpenAgentInstall,
}: HeaderBarProps): React.JSX.Element {
  const [isJobDropdownOpen, setIsJobDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const activeRun = useMemo(() => {
    if (!activeJobId) return null;
    return recentRuns.find((r) => (r.jobId || r.job_id || r.id) === activeJobId) ?? null;
  }, [activeJobId, recentRuns]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsJobDropdownOpen(false);
      }
    }
    if (isJobDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isJobDropdownOpen]);

  function handleCrawlerStatusClick(): void {
    if (!isAgentConnected) {
      onOpenAgentInstall?.();
      return;
    }
    if (!isAgentBrowserLoggedIn) {
      (onOpenAuthModal ?? onLaunchLogin)();
      return;
    }
    onOpenAgentInstall?.();
  }

  return (
    <header className="relative z-40 flex flex-col gap-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 shadow-sm backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
      {/* 3 Stage Wizard Tabs */}
      <nav aria-label="Các giai đoạn quy trình" className="flex items-center gap-1.5 overflow-x-auto sm:gap-2">
        {/* Step 1 */}
        <button
          type="button"
          onClick={() => onSelectStage?.(1)}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition sm:text-sm cursor-pointer ${
            currentStage === 1
              ? "bg-blue-600 text-white font-bold shadow-sm ring-2 ring-blue-300 dark:ring-blue-400"
              : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs font-medium">
            1
          </span>
          <span>1. Quét Trend</span>
        </button>

        <span className="text-slate-500 dark:text-slate-400 font-bold">➔</span>

        {/* Step 2 */}
        <button
          type="button"
          onClick={() => {
            if (isStage2Available) {
              onSelectStage?.(2);
            }
          }}
          disabled={!isStage2Available}
          title={!isStage2Available ? "Cần hoàn thành quét mẫu ở Bước 1 trước" : "Chuyển sang Bước 2: Duyệt và chọn mẫu"}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition sm:text-sm ${
            currentStage === 2
              ? "bg-blue-600 text-white font-medium ring-2 ring-blue-300 dark:ring-blue-400"
              : isStage2Available
                ? "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                : "bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-50"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs font-medium">
            2
          </span>
          <span>2. Duyệt Ứng viên</span>
          {candidateCount > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-xs font-bold ${
                currentStage === 2 ? "bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300" : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300"
              }`}
            >
              {candidateCount}
            </span>
          )}
        </button>

        <span className="text-slate-500 dark:text-slate-400 font-bold">➔</span>

        {/* Step 3 */}
        <button
          type="button"
          onClick={() => {
            if (isStage3Available) {
              onSelectStage?.(3);
            }
          }}
          disabled={!isStage3Available}
          title={!isStage3Available ? "Cần chọn mẫu và bấm sản xuất ở Bước 2 trước" : "Chuyển sang Bước 3: Thành phẩm & Bàn giao"}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition sm:text-sm ${
            currentStage === 3
              ? "bg-blue-600 text-white font-medium ring-2 ring-blue-300 dark:ring-blue-400"
              : isStage3Available
                ? "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                : "bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-50"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs font-medium">
            3
          </span>
          <span>3. Thành phẩm</span>
          {isProducing && (
            <span className="animate-pulse text-xs text-amber-700 dark:text-amber-300">
              ●
            </span>
          )}
        </button>
      </nav>

      {/* Center: Job Selector Quick Switcher */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsJobDropdownOpen((prev) => !prev)}
          className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 shadow-sm transition hover:border-blue-300 dark:hover:border-blue-800 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          title="Bấm để chuyển đổi Job hoặc tạo đợt quét mới"
        >
          <span className="text-blue-700 dark:text-blue-300 text-sm"><AppIcon name="folder" /></span>
          <div className="flex items-center gap-1.5 max-w-[180px] sm:max-w-[240px] truncate text-left">
            {activeRun ? (
              <>
                <span className="truncate text-slate-900 dark:text-slate-100 font-bold">
                  {activeRun.niche || activeRun.title || activeJobId}
                </span>
                {activeRun.status === "completed" && (
                  <span className="rounded bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.2 text-xs font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 whitespace-nowrap">
                    ✓ Thành phẩm
                  </span>
                )}
                {activeRun.status === "ready_for_review" && (
                  <span className="rounded bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.2 text-xs font-bold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 whitespace-nowrap">
                    <AppIcon name="clock" /> Chờ duyệt
                  </span>
                )}
                {activeRun.status === "running" && (
                  <span className="rounded bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.2 text-xs font-bold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 whitespace-nowrap">
                    <AppIcon name="refresh" /> Đang chạy
                  </span>
                )}
              </>
            ) : activeJobId ? (
              <span className="font-mono text-slate-700 dark:text-slate-300 truncate">{activeJobId}</span>
            ) : (
              <span className="text-slate-600 dark:text-slate-400">+ Chọn / Tạo Job mới</span>
            )}
          </div>
          <span className="text-xs text-slate-600 dark:text-slate-400">▼</span>
        </button>

        {/* Floating Dropdown Panel */}
        {isJobDropdownOpen && (
          <div className="absolute top-full left-0 sm:left-auto sm:right-0 mt-2 z-50 w-84 sm:w-96 max-h-96 overflow-y-auto rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm p-2.5 flex flex-col gap-1.5 text-xs animate-in fade-in duration-150">
            {/* Top Action: Tạo Job mới */}
            <button
              type="button"
              onClick={() => {
                setIsJobDropdownOpen(false);
                onNewJob?.();
              }}
              className="flex items-center gap-2.5 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-2.5 font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/80 transition text-left cursor-pointer"
            >
              <span className="text-lg">➕</span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-blue-700 dark:text-blue-300">Bắt đầu đợt quét mới</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-normal">Cấu hình từ khóa và quét Pinterest từ đầu</p>
              </div>
            </button>

            <div className="border-t border-slate-200 dark:border-slate-700" />

            <div className="px-2 py-1 text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Lịch sử Job &amp; Thư mục Run</span>
              <span className="rounded-full bg-slate-50 dark:bg-slate-800 px-2 py-0.2 text-slate-700 dark:text-slate-300">{recentRuns.length}</span>
            </div>

            {recentRuns.length === 0 ? (
              <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-xs">
                Chưa có job hoặc thư mục run nào.
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
                {recentRuns.map((r) => {
                  const targetId = r.jobId || r.job_id || r.id;
                  const isSelected = activeJobId === targetId;
                  const isCompleted = r.status === "completed";
                  const isReview = r.status === "ready_for_review";
                  const isFailed = r.status === "failed";
                  const rNiche = r.niche || r.title || targetId;

                  return (
                    <button
                      key={targetId}
                      type="button"
                      onClick={() => {
                        setIsJobDropdownOpen(false);
                        onLoadJob?.(targetId);
                      }}
                      className={`flex items-center justify-between gap-2.5 rounded-lg p-2.5 text-left transition cursor-pointer ${
                        isSelected
                          ? "bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 shadow-sm"
                          : "hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-transparent"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <strong className="truncate font-semibold text-slate-900 dark:text-slate-100 text-xs">{rNiche}</strong>
                          <span className="rounded bg-slate-50 dark:bg-slate-800 px-1.5 py-0.2 text-xs text-slate-600 dark:text-slate-400 uppercase font-semibold">
                            {r.product || r.productType || "rug"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
                          {isCompleted && (
                            <span className="text-emerald-700 dark:text-emerald-300 font-bold">✓ Thành phẩm</span>
                          )}
                          {isReview && (
                            <span className="text-amber-700 dark:text-amber-300 font-bold"><AppIcon name="clock" /> Chờ duyệt ({r.candidateCount ?? 0})</span>
                          )}
                          {isFailed && (
                            <span className="text-rose-700 dark:text-rose-300 font-bold">✕ Lỗi</span>
                          )}
                          {r.cmykCount && r.cmykCount > 0 ? (
                            <span className="text-blue-700 dark:text-blue-300">• {r.cmykCount} CMYK</span>
                          ) : null}
                          {r.mockupCount && r.mockupCount > 0 ? (
                            <span className="text-blue-700 dark:text-blue-300">• {r.mockupCount} Mockup</span>
                          ) : null}
                          <code className="text-slate-500 dark:text-slate-400 font-mono text-xs truncate">{targetId}</code>
                        </div>
                      </div>
                      {isSelected && <span className="text-blue-700 dark:text-blue-300 font-bold text-sm">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Consolidated Pinterest API and crawler controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenAuthModal ?? onLaunchLogin}
          disabled={isLoggingIn}
          title={
            authStatus?.oauth_valid
              ? `Pinterest API đã kết nối${authStatus.token_info?.username ? ` (@${authStatus.token_info.username})` : ""}. Bấm để quản lý OAuth hoặc token.`
              : "Pinterest API chưa kết nối. Bấm để cấu hình OAuth hoặc token."
          }
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70 ${
            authStatus?.oauth_valid
              ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
              : "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300"
          }`}
        >
          {isLoggingIn ? (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <span className={`h-2 w-2 rounded-full ${authStatus?.oauth_valid ? "bg-emerald-700" : "bg-rose-600"}`} />
          )}
          <span>
            {isLoggingIn
              ? "Pinterest API · Đang mở..."
              : authStatus?.oauth_valid
                ? "Pinterest API · Sẵn sàng"
                : "Pinterest API · Cần kết nối"}
          </span>
        </button>

        <button
          type="button"
          onClick={handleCrawlerStatusClick}
          title={
            !isAgentConnected
              ? "Chưa có Crawler Agent online. Bấm để kết nối máy cào."
              : isAgentBrowserLoggedIn
                ? `Crawler ${agentName || "hiện tại"} đã sẵn sàng. Bấm để quản lý máy cào.`
                : `Crawler ${agentName || "hiện tại"} chưa đăng nhập Pinterest browser. Bấm để đăng nhập.`
          }
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:brightness-110 ${
            isAgentConnected && isAgentBrowserLoggedIn
              ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
              : isAgentConnected
                ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300"
                : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isAgentConnected && isAgentBrowserLoggedIn
                ? "bg-blue-600"
                : isAgentConnected
                  ? "bg-amber-700"
                  : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
          <span>
            {!isAgentConnected
              ? "Crawler · Offline"
              : isAgentBrowserLoggedIn
                ? "Crawler · Online · Đã login"
                : "Crawler · Online · Chưa login"}
          </span>
        </button>
      </div>
    </header>
  );
}
