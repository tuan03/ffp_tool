import type { PinterestAuthStatus } from "../../types";

interface HeaderBarProps {
  readonly currentStage: 1 | 2 | 3;
  readonly onSelectStage?: (stage: 1 | 2 | 3) => void;
  readonly authStatus: PinterestAuthStatus | null;
  readonly isLoggingIn: boolean;
  readonly onLaunchLogin: () => void;
}

export function HeaderBar({
  currentStage,
  onSelectStage,
  authStatus,
  isLoggingIn,
  onLaunchLogin,
}: HeaderBarProps): React.JSX.Element {
  const isLoggedIn = authStatus?.logged_in ?? false;

  return (
    <header className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
      {/* 3 Stage Pills */}
      <nav aria-label="Các giai đoạn xử lý" className="flex items-center gap-1.5 overflow-x-auto sm:gap-2">
        <button
          type="button"
          onClick={() => onSelectStage?.(1)}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
            currentStage === 1
              ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/30 text-xs font-bold">
            1
          </span>
          <span>1. Quét Trend &amp; Chọn lọc</span>
        </button>

        <span className="text-slate-600">➔</span>

        <button
          type="button"
          onClick={() => onSelectStage?.(2)}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
            currentStage === 2
              ? "bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/30 text-xs font-bold">
            2
          </span>
          <span>2. Duyệt Ứng viên (Review)</span>
        </button>

        <span className="text-slate-600">➔</span>

        <button
          type="button"
          onClick={() => onSelectStage?.(3)}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
            currentStage === 3
              ? "bg-emerald-400 text-slate-950 shadow-md shadow-emerald-400/20"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/30 text-xs font-bold">
            3
          </span>
          <span>3. Thành phẩm &amp; Bàn giao</span>
        </button>
      </nav>

      {/* Auth Status & Login Button */}
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
            isLoggedIn
              ? "border-emerald-700/50 bg-emerald-950/60 text-emerald-300"
              : "border-rose-700/50 bg-rose-950/60 text-rose-300"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${isLoggedIn ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
          <span>{authStatus?.status_text ?? (isLoggedIn ? "Pinterest: Đã kết nối" : "Pinterest: Chưa đăng nhập")}</span>
        </div>

        {!isLoggedIn && (
          <button
            type="button"
            onClick={onLaunchLogin}
            disabled={isLoggingIn}
            className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-rose-500 disabled:opacity-50"
          >
            {isLoggingIn ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Đang kết nối...</span>
              </>
            ) : (
              <>
                <span>🔑</span>
                <span>Đăng nhập Pinterest</span>
              </>
            )}
          </button>
        )}
      </div>
    </header>
  );
}
