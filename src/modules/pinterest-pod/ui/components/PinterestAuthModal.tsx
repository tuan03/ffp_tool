import { useEffect, useState } from "react";

import type {
  PinterestAuthStatus,
  PinterestPodClient,
  SavePinterestTokenPayload,
} from "../../types";

export interface PinterestAuthModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly authStatus: PinterestAuthStatus | null;
  readonly onRefreshStatus: () => Promise<void>;
  readonly client?: PinterestPodClient;
  readonly isLoggingIn: boolean;
  readonly onLaunchBrowserLogin: () => void;
}

export function PinterestAuthModal({
  isOpen,
  onClose,
  authStatus,
  onRefreshStatus,
  client,
  isLoggingIn,
  onLaunchBrowserLogin,
}: PinterestAuthModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<"oauth" | "manual" | "browser">("oauth");
  const [callbackUrlOrCode, setCallbackUrlOrCode] = useState("");
  const [manualAccessToken, setManualAccessToken] = useState("");
  const [manualRefreshToken, setManualRefreshToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isBrowserActive, setIsBrowserActive] = useState(false);

  // Listen for postMessage from popup OAuth callback
  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent): void {
      if (event.data && typeof event.data === "object" && (event.data as Record<string, unknown>).type === "PINTEREST_OAUTH_SUCCESS") {
        setFeedback({
          type: "success",
          message: "Kết nối tài khoản Pinterest thành công qua OAuth!",
        });
        void onRefreshStatus();
      }
    }
    window.addEventListener("message", handleOAuthMessage);
    return () => {
      window.removeEventListener("message", handleOAuthMessage);
    };
  }, [onRefreshStatus]);

  // Poll authStatus when browser login is active
  useEffect(() => {
    if (!isBrowserActive && !authStatus?.browser_process_active) return;
    const interval = setInterval(() => {
      void onRefreshStatus();
    }, 2500);

    return () => {
      clearInterval(interval);
    };
  }, [isBrowserActive, authStatus?.browser_process_active, onRefreshStatus]);

  // React to authStatus updates while browser is active
  useEffect(() => {
    if (!isBrowserActive) return;
    if (authStatus?.browser_logged_in) {
      setIsBrowserActive(false);
      setFeedback({
        type: "success",
        message: "🎉 Đăng nhập Pinterest thành công! Phiên trình duyệt crawler đã được lưu trữ an toàn.",
      });
      return;
    }

    if (authStatus && authStatus.browser_process_active === false && !isLoggingIn) {
      setIsBrowserActive(false);
    }
  }, [isBrowserActive, authStatus, isLoggingIn]);

  if (!isOpen) return null;

  const isOAuthValid = authStatus?.oauth_valid ?? false;
  const isBrowserLoggedIn = authStatus?.browser_logged_in ?? false;
  const authUrl = authStatus?.auth_url;

  function handleOpenOAuthPopup(): void {
    setFeedback(null);
    if (!authUrl) {
      setFeedback({
        type: "error",
        message: "Chưa cấu hình PINTEREST_APP_ID trong .env của server. Vui lòng kiểm tra lại cấu hình.",
      });
      return;
    }
    const width = 600;
    const height = 750;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      authUrl,
      "PinterestOAuthLogin",
      `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no`,
    );

    // Poll popup closure
    if (popup) {
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          void onRefreshStatus();
        }
      }, 1000);
    }
  }

  async function handleExchangeCode(): Promise<void> {
    if (!callbackUrlOrCode.trim()) {
      setFeedback({ type: "error", message: "Vui lòng nhập URL chuyển hướng hoặc mã Code." });
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      if (client?.saveOAuthToken) {
        const res = await client.saveOAuthToken({
          code: callbackUrlOrCode.trim(),
        });
        if (res.ok) {
          setFeedback({
            type: "success",
            message: res.message || "Đã kết nối và lưu token Pinterest thành công!",
          });
          setCallbackUrlOrCode("");
          await onRefreshStatus();
        } else {
          setFeedback({
            type: "error",
            message: res.message || "Không thể trao đổi mã token.",
          });
        }
      } else {
        throw new Error("Client không hỗ trợ lưu token trực tiếp.");
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Lỗi khi gửi mã xác thực.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveManualToken(): Promise<void> {
    const token = manualAccessToken.trim();
    if (!token) {
      setFeedback({ type: "error", message: "Vui lòng nhập Access Token (bắt đầu bằng pina_...)." });
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      if (client?.saveOAuthToken) {
        const payload: SavePinterestTokenPayload = {
          access_token: token,
          refresh_token: manualRefreshToken.trim() || undefined,
        };
        const res = await client.saveOAuthToken(payload);
        if (res.ok) {
          setFeedback({
            type: "success",
            message: res.message || `Đã kết nối thành công tài khoản @${res.username || "pinterest"}!`,
          });
          setManualAccessToken("");
          setManualRefreshToken("");
          await onRefreshStatus();
        } else {
          setFeedback({
            type: "error",
            message: res.message || "Token không hợp lệ hoặc đã hết hạn.",
          });
        }
      } else {
        throw new Error("Client không hỗ trợ lưu token.");
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Lỗi khi kiểm tra và lưu token.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pinterest-auth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400 font-bold text-base">
                🔑
              </span>
              <h2 id="pinterest-auth-modal-title" className="text-lg font-bold text-slate-100">
                Quản lý Xác thực & Đăng nhập Pinterest
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Kết nối API Token để quét Pinterest Trends và phiên trình duyệt để tải ảnh mẫu chất lượng cao.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Status Indicators Overview */}
        <div className="my-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* API Token Box */}
          <div
            className={`rounded-xl border p-3 text-xs transition ${
              isOAuthValid
                ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-300"
                : "border-rose-800/60 bg-rose-950/30 text-rose-300"
            }`}
          >
            <div className="flex items-center justify-between font-bold">
              <span>1. API Token (Quét Trends)</span>
              <span className={`inline-flex h-2 w-2 rounded-full ${isOAuthValid ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
            </div>
            <div className="mt-1.5 text-[11px]">
              {isOAuthValid ? (
                <div className="space-y-0.5 text-slate-300">
                  <p className="text-emerald-400 font-semibold">✓ Đã kết nối token hợp lệ</p>
                  {authStatus?.token_info?.username && (
                    <p className="text-slate-400">Tài khoản: @{authStatus.token_info.username}</p>
                  )}
                  {authStatus?.token_info?.has_refresh_token && (
                    <p className="text-emerald-500/80 text-[10px]">Tự động gia hạn (Refresh Token: Có)</p>
                  )}
                </div>
              ) : (
                <p className="text-rose-400 font-semibold">✕ Chưa có token (Bắt buộc để quét Trends)</p>
              )}
            </div>
          </div>

          {/* Browser Profile Box */}
          <div
            className={`rounded-xl border p-3 text-xs transition ${
              isBrowserLoggedIn
                ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-300"
                : "border-amber-800/60 bg-amber-950/30 text-amber-300"
            }`}
          >
            <div className="flex items-center justify-between font-bold">
              <span>2. Phiên duyệt Crawler (Cào ảnh)</span>
              <span className={`inline-flex h-2 w-2 rounded-full ${isBrowserLoggedIn ? "bg-emerald-400" : "bg-amber-400"}`} />
            </div>
            <div className="mt-1.5 text-[11px]">
              {isBrowserLoggedIn ? (
                <p className="text-emerald-400 font-semibold">✓ Đã lưu session Playwright</p>
              ) : (
                <p className="text-amber-400 font-semibold">! Chưa mở phiên đăng nhập</p>
              )}
              <p className="text-slate-400 text-[10px] mt-0.5">Dùng để cào ảnh nét mà không bị chặn bot.</p>
            </div>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mb-4 flex items-center justify-between rounded-xl p-3 text-xs font-semibold ${
              feedback.type === "success"
                ? "border border-emerald-700 bg-emerald-950/80 text-emerald-200"
                : "border border-rose-700 bg-rose-950/80 text-rose-200"
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tab Selection */}
        <div className="flex items-center gap-1 border-b border-slate-800 pb-2 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("oauth")}
            className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
              activeTab === "oauth"
                ? "bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            ⚡ Kết nối 1-Click (OAuth)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("manual")}
            className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
              activeTab === "manual"
                ? "bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            📝 Dán Token Thủ Công
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("browser")}
            className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
              activeTab === "browser"
                ? "bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            🌐 Trình duyệt Cào ảnh
          </button>
        </div>

        {/* Tab 1: OAuth Flow */}
        {activeTab === "oauth" && (
          <div className="mt-4 flex flex-col gap-4 text-xs">
            <div className="rounded-xl bg-slate-950/60 p-4 border border-slate-800/80">
              <h3 className="font-bold text-slate-200 text-sm">Ủy quyền chính thức từ Pinterest</h3>
              <p className="mt-1 text-slate-400 leading-relaxed">
                Bấm nút bên dưới để mở trang đăng nhập Pinterest. Sau khi bạn chọn <strong>Authorize (Ủy quyền)</strong>, token sẽ được tự động đồng bộ về hệ thống FFP.
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleOpenOAuthPopup}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-5 py-2.5 font-bold text-white shadow-lg shadow-rose-600/30 transition hover:from-rose-500 hover:to-red-500 cursor-pointer"
                >
                  <span>Mở Cửa Sổ Ủy Quyền Pinterest</span>
                  <span>↗</span>
                </button>
              </div>
            </div>

            {/* Fallback code exchange */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-slate-400">
              <label htmlFor="callback-input" className="font-bold text-slate-300 block mb-1 text-[11px]">
                Hoặc dán URL chuyển hướng / Mã Authorization Code nếu cửa sổ không tự đóng:
              </label>
              <div className="flex gap-2 mt-1">
                <input
                  id="callback-input"
                  type="text"
                  value={callbackUrlOrCode}
                  onChange={(e) => setCallbackUrlOrCode(e.target.value)}
                  placeholder="http://localhost:4000/api/v1/oauth/pinterest/callback?code=..."
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-rose-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isSaving || !callbackUrlOrCode.trim()}
                  onClick={() => void handleExchangeCode()}
                  className="rounded-lg bg-slate-700 px-4 py-1.5 font-bold text-slate-100 hover:bg-slate-600 disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? "Đang lưu..." : "Xác nhận & Lưu"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Manual Access Token */}
        {activeTab === "manual" && (
          <div className="mt-4 flex flex-col gap-3 text-xs">
            <div>
              <label htmlFor="access-token-input" className="font-bold text-slate-300 block mb-1">
                Pinterest Access Token <span className="text-rose-400">*</span>:
              </label>
              <input
                id="access-token-input"
                type="password"
                value={manualAccessToken}
                onChange={(e) => setManualAccessToken(e.target.value)}
                placeholder="pina_HAA..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 font-mono focus:border-rose-500 focus:outline-none"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Token được tạo từ Pinterest Developer Portal (App 1595071 &gt; Generate Token).
              </span>
            </div>

            <div>
              <label htmlFor="refresh-token-input" className="font-bold text-slate-300 block mb-1">
                Refresh Token (Tùy chọn - để tự động gia hạn):
              </label>
              <input
                id="refresh-token-input"
                type="password"
                value={manualRefreshToken}
                onChange={(e) => setManualRefreshToken(e.target.value)}
                placeholder="pinr_..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 font-mono focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div className="pt-2">
              <button
                type="button"
                disabled={isSaving || !manualAccessToken.trim()}
                onClick={() => void handleSaveManualToken()}
                className="rounded-xl bg-rose-600 px-5 py-2 font-bold text-white shadow hover:bg-rose-500 disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? "Đang kiểm tra & lưu..." : "Kiểm tra & Lưu Token"}
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Browser Session */}
        {activeTab === "browser" && (
          <div className="mt-4 flex flex-col gap-4 text-xs">
            <div className="rounded-xl bg-slate-950/60 p-4 border border-slate-800/80">
              <h3 className="font-bold text-slate-200 text-sm">Đăng nhập tài khoản trình duyệt (Playwright)</h3>
              <p className="mt-1 text-slate-400 leading-relaxed">
                Hệ thống sẽ mở một cửa sổ trình duyệt Chromium riêng biệt. Bạn chỉ cần đăng nhập tài khoản Pinterest của mình vào đó. Trình duyệt sẽ tự động đóng và lưu trữ cookie phiên làm việc để phục vụ crawler ảnh.
              </p>

              {(isBrowserActive || authStatus?.browser_process_active) && (
                <div className="mt-3 rounded-xl border border-indigo-500/40 bg-indigo-950/50 p-3.5 text-indigo-200 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2 font-bold text-indigo-300">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500" />
                    </span>
                    <span>Cửa sổ Chromium đang hoạt động trên màn hình!</span>
                  </div>
                  <p className="mt-1.5 text-slate-300 text-[11px] leading-relaxed">
                    Vui lòng kiểm tra cửa sổ Chromium (biểu tượng trình duyệt trên thanh Dock / Taskbar).
                    Hãy hoàn tất <strong>đăng nhập tài khoản Pinterest</strong> của bạn tại đó.
                  </p>
                  <p className="mt-1 text-[11px] text-indigo-400 font-semibold">
                    💡 Cửa sổ sẽ tự động đóng và hệ thống sẽ lập tức cập nhật trạng thái khi đăng nhập thành công.
                  </p>
                </div>
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  disabled={isLoggingIn || isBrowserActive || (authStatus?.browser_process_active ?? false)}
                  onClick={() => {
                    setIsBrowserActive(true);
                    setFeedback(null);
                    onLaunchBrowserLogin();
                  }}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
                >
                  {(isLoggingIn || isBrowserActive || (authStatus?.browser_process_active ?? false)) && (
                    <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  <span>
                    {isBrowserActive || (authStatus?.browser_process_active ?? false)
                      ? "Cửa sổ đang mở • Chờ đăng nhập..."
                      : isLoggingIn
                      ? "Đang mở Chromium..."
                      : "Mở Trình Duyệt Đăng Nhập"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void onRefreshStatus()}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  Kiểm tra lại trạng thái
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 flex justify-end border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
