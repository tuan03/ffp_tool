import { useEffect, useMemo, useRef, useState } from "react";

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
}: HeaderBarProps): React.JSX.Element {
  const isLoggedIn = authStatus?.logged_in ?? false;
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

  return (
    <header className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
      {/* 3 Stage Wizard Tabs */}
      <nav aria-label="Các giai đoạn quy trình" className="flex items-center gap-1.5 overflow-x-auto sm:gap-2">
        {/* Step 1 */}
        <button
          type="button"
          onClick={() => onSelectStage?.(1)}
          className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition sm:text-sm cursor-pointer ${
            currentStage === 1
              ? "bg-cyan-500 text-slate-950 font-bold shadow-lg shadow-cyan-500/25 ring-2 ring-cyan-400"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/30 text-xs font-bold">
            1
          </span>
          <span>1. Quét Trend</span>
        </button>

        <span className="text-slate-600 font-bold">➔</span>

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
          className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition sm:text-sm ${
            currentStage === 2
              ? "bg-amber-400 text-slate-950 font-bold shadow-lg shadow-amber-400/25 ring-2 ring-amber-300"
              : isStage2Available
                ? "bg-slate-800 text-amber-300 hover:bg-slate-700 hover:text-amber-200 cursor-pointer"
                : "bg-slate-900/60 text-slate-500 border border-slate-800/80 cursor-not-allowed opacity-50"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/30 text-xs font-bold">
            2
          </span>
          <span>2. Duyệt Ứng viên</span>
          {candidateCount > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                currentStage === 2 ? "bg-slate-950 text-amber-300" : "bg-amber-950 text-amber-300"
              }`}
            >
              {candidateCount}
            </span>
          )}
        </button>

        <span className="text-slate-600 font-bold">➔</span>

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
          className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition sm:text-sm ${
            currentStage === 3
              ? "bg-emerald-400 text-slate-950 font-bold shadow-lg shadow-emerald-400/25 ring-2 ring-emerald-300"
              : isStage3Available
                ? "bg-slate-800 text-emerald-300 hover:bg-slate-700 hover:text-emerald-200 cursor-pointer"
                : "bg-slate-900/60 text-slate-500 border border-slate-800/80 cursor-not-allowed opacity-50"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/30 text-xs font-bold">
            3
          </span>
          <span>3. Thành phẩm</span>
          {isProducing && (
            <span className="animate-pulse text-[10px] text-amber-400">
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
          className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-sm transition hover:border-cyan-500 hover:bg-slate-800 cursor-pointer"
          title="Bấm để chuyển đổi Job hoặc tạo đợt quét mới"
        >
          <span className="text-cyan-400 text-sm">📁</span>
          <div className="flex items-center gap-1.5 max-w-[180px] sm:max-w-[240px] truncate text-left">
            {activeRun ? (
              <>
                <span className="truncate text-slate-100 font-bold">
                  {activeRun.niche || activeRun.title || activeJobId}
                </span>
                {activeRun.status === "completed" && (
                  <span className="rounded bg-emerald-950/80 px-1.5 py-0.2 text-[10px] font-bold text-emerald-300 border border-emerald-700/60 whitespace-nowrap">
                    ✓ Thành phẩm
                  </span>
                )}
                {activeRun.status === "ready_for_review" && (
                  <span className="rounded bg-amber-950/80 px-1.5 py-0.2 text-[10px] font-bold text-amber-300 border border-amber-700/60 whitespace-nowrap">
                    ⏳ Chờ duyệt
                  </span>
                )}
                {activeRun.status === "running" && (
                  <span className="rounded bg-cyan-950/80 px-1.5 py-0.2 text-[10px] font-bold text-cyan-300 border border-cyan-700/60 whitespace-nowrap">
                    🔄 Đang chạy
                  </span>
                )}
              </>
            ) : activeJobId ? (
              <span className="font-mono text-slate-300 truncate">{activeJobId}</span>
            ) : (
              <span className="text-slate-400">+ Chọn / Tạo Job mới</span>
            )}
          </div>
          <span className="text-[10px] text-slate-400">▼</span>
        </button>

        {/* Floating Dropdown Panel */}
        {isJobDropdownOpen && (
          <div className="absolute top-full left-0 sm:left-auto sm:right-0 mt-2 z-50 w-84 sm:w-96 max-h-96 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl p-2.5 flex flex-col gap-1.5 text-xs animate-in fade-in duration-150">
            {/* Top Action: Tạo Job mới */}
            <button
              type="button"
              onClick={() => {
                setIsJobDropdownOpen(false);
                onNewJob?.();
              }}
              className="flex items-center gap-2.5 rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-2.5 font-bold text-cyan-300 hover:bg-cyan-900/40 transition text-left cursor-pointer"
            >
              <span className="text-lg">➕</span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-cyan-300">Bắt đầu đợt quét mới</p>
                <p className="text-[10px] text-slate-400 font-normal">Cấu hình từ khóa và quét Pinterest từ đầu</p>
              </div>
            </button>

            <div className="border-t border-slate-800" />

            <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Lịch sử Job &amp; Thư mục Run</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.2 text-slate-300">{recentRuns.length}</span>
            </div>

            {recentRuns.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-xs">
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
                      className={`flex items-center justify-between gap-2.5 rounded-xl p-2.5 text-left transition cursor-pointer ${
                        isSelected
                          ? "bg-cyan-950/70 border border-cyan-500/60 text-cyan-100 shadow-sm"
                          : "hover:bg-slate-800/80 text-slate-300 border border-transparent"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <strong className="truncate font-semibold text-slate-100 text-xs">{rNiche}</strong>
                          <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[9px] text-slate-400 uppercase font-semibold">
                            {r.product || r.productType || "rug"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                          {isCompleted && (
                            <span className="text-emerald-300 font-bold">✓ Thành phẩm</span>
                          )}
                          {isReview && (
                            <span className="text-amber-300 font-bold">⏳ Chờ duyệt ({r.candidateCount ?? 0})</span>
                          )}
                          {isFailed && (
                            <span className="text-rose-400 font-bold">✕ Lỗi</span>
                          )}
                          {r.cmykCount && r.cmykCount > 0 ? (
                            <span className="text-cyan-300">• {r.cmykCount} CMYK</span>
                          ) : null}
                          {r.mockupCount && r.mockupCount > 0 ? (
                            <span className="text-indigo-300">• {r.mockupCount} Mockup</span>
                          ) : null}
                          <code className="text-slate-500 font-mono text-[9px] truncate">{targetId}</code>
                        </div>
                      </div>
                      {isSelected && <span className="text-cyan-400 font-bold text-sm">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Auth Status & Login Buttons */}
      <div className="flex items-center gap-2">
        {/* OAuth API Status Indicator */}
        <button
          type="button"
          onClick={onOpenAuthModal}
          title={
            authStatus?.oauth_valid
              ? `API Token: Đã kết nối${authStatus?.token_info?.username ? ` (@${authStatus.token_info.username})` : ""} - Bấm để quản lý`
              : "API Token: Chưa kết nối (Bắt buộc để quét Trends) - Bấm để kết nối"
          }
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium cursor-pointer transition hover:opacity-90 ${
            authStatus?.oauth_valid
              ? "border-emerald-700/50 bg-emerald-950/60 text-emerald-300"
              : "border-rose-700/50 bg-rose-950/60 text-rose-300 animate-pulse"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${authStatus?.oauth_valid ? "bg-emerald-400" : "bg-rose-400"}`} />
          <span>{authStatus?.oauth_valid ? "API Token OK" : "Thiếu Token API"}</span>
        </button>

        {/* Browser Profile Indicator */}
        <button
          type="button"
          onClick={onOpenAuthModal}
          title={
            authStatus?.browser_logged_in
              ? "Trình duyệt cào ảnh: Đã lưu session Playwright"
              : "Trình duyệt cào ảnh: Chưa đăng nhập - Bấm để đăng nhập"
          }
          className={`hidden sm:flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium cursor-pointer transition hover:opacity-90 ${
            authStatus?.browser_logged_in
              ? "border-cyan-700/50 bg-cyan-950/60 text-cyan-300"
              : "border-slate-700/60 bg-slate-800/60 text-slate-400"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${authStatus?.browser_logged_in ? "bg-cyan-400" : "bg-slate-500"}`} />
          <span>{authStatus?.browser_logged_in ? "Crawler OK" : "Crawler chưa login"}</span>
        </button>

        {/* Manage Auth Modal Trigger */}
        <button
          type="button"
          onClick={onOpenAuthModal ?? onLaunchLogin}
          disabled={isLoggingIn}
          title="Mở bảng cấu hình xác thực Pinterest (1-Click OAuth, Token thủ công, Trình duyệt Playwright)"
          className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow transition hover:border-cyan-500 hover:bg-slate-700 hover:text-white cursor-pointer"
        >
          {isLoggingIn ? (
            <>
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Đang mở...</span>
            </>
          ) : (
            <>
              <span>🔑</span>
              <span>Xác thực Pinterest</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}
