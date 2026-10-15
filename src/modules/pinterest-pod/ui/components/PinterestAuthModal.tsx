import { useEffect, useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
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
  readonly isAgentConnected?: boolean;
  readonly agentName?: string;
  readonly isAgentBrowserLoggedIn?: boolean;
}

export function PinterestAuthModal({
  isOpen,
  onClose,
  authStatus,
  onRefreshStatus,
  client,
  isLoggingIn,
  onLaunchBrowserLogin,
  isAgentConnected = false,
  agentName,
  isAgentBrowserLoggedIn = false,
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
  const isBrowserLoggedIn = isAgentBrowserLoggedIn;
  const authUrl = authStatus?.auth_url;
  const agentLoginCommand = '& "$env:LOCALAPPDATA\\FFP\\CrawlerAgent\\.venv\\Scripts\\python.exe" "$env:LOCALAPPDATA\\FFP\\CrawlerAgent\\src\\modules\\pinterest-pod\\server\\pinterest\\pinterest_browser_login.py"';

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div className="relative flex w-full max-w-2xl flex-col rounded-lg border border-slate-300 bg-white p-6 shadow-sm">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-700 font-bold text-base">
                🔑
              </span>
              <h2 id="pinterest-auth-modal-title" className="text-lg font-bold text-slate-900">
                Quản lý Xác thực & Đăng nhập Pinterest
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Kết nối API Token để quét Pinterest Trends và phiên trình duyệt để tải ảnh mẫu chất lượng cao.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="rounded-lg p-1.5 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {authStatus?.oauth_config_error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
            Cấu hình OAuth chưa hoàn chỉnh: {authStatus.oauth_config_error}
          </div>
        )}

        {/* Status Indicators Overview */}
        <div className="my-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* API Token Box */}
          <div
            className={`rounded-lg border p-3 text-xs transition ${
              isOAuthValid
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            <div className="flex items-center justify-between font-bold">
              <span>1. API Token (Quét Trends)</span>
              <span className={`inline-flex h-2 w-2 rounded-full ${isOAuthValid ? "bg-emerald-700 animate-pulse" : "bg-rose-600"}`} />
            </div>
            <div className="mt-1.5 text-xs">
              {isOAuthValid ? (
                <div className="space-y-0.5 text-slate-700">
                  <p className="text-emerald-700 font-semibold">✓ Đã lưu token; quyền Trends sẽ được kiểm tra khi quét</p>
                  {authStatus?.token_info?.username && (
                    <p className="text-slate-600">Tài khoản: @{authStatus.token_info.username}</p>
                  )}
                  {authStatus?.token_info?.has_refresh_token && (
                    <p className="text-emerald-700 text-xs">Tự động gia hạn (Refresh Token: Có)</p>
                  )}
                </div>
              ) : (
                <p className="text-rose-700 font-semibold">✕ Chưa có token (Bắt buộc để quét Trends)</p>
              )}
            </div>
          </div>

          {/* Browser Profile Box */}
          <div
            className={`rounded-lg border p-3 text-xs transition ${
              isBrowserLoggedIn
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            <div className="flex items-center justify-between font-bold">
              <span>2. Phiên duyệt trên Crawler Agent</span>
              <span className={`inline-flex h-2 w-2 rounded-full ${isBrowserLoggedIn ? "bg-emerald-700" : "bg-amber-700"}`} />
            </div>
            <div className="mt-1.5 text-xs">
              {isBrowserLoggedIn ? (
                <p className="text-emerald-700 font-semibold">✓ {agentName ?? "Crawler agent"} đã lưu session</p>
              ) : (
                <p className="text-amber-700 font-semibold">{isAgentConnected ? "! Agent chưa đăng nhập Pinterest" : "! Chưa có crawler agent online"}</p>
              )}
              <p className="text-slate-600 text-xs mt-0.5">Trạng thái được báo từ máy agent, không phải trình duyệt trong VPS.</p>
            </div>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mb-4 flex items-center justify-between rounded-lg p-3 text-xs font-semibold ${
              feedback.type === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-slate-600 hover:text-slate-900"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tab Selection */}
        <div className="flex items-center gap-1 border-b border-slate-200 pb-2 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("oauth")}
            className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
              activeTab === "oauth"
                ? "bg-rose-50 text-rose-700 font-bold border border-rose-300"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <AppIcon name="seo" /> Kết nối 1-Click (OAuth)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("manual")}
            className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
              activeTab === "manual"
                ? "bg-rose-50 text-rose-700 font-bold border border-rose-300"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <AppIcon name="review" /> Dán Token Thủ Công
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("browser")}
            className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
              activeTab === "browser"
                ? "bg-rose-50 text-rose-700 font-bold border border-rose-300"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            🌐 Trình duyệt Cào ảnh
          </button>
        </div>

        {/* Tab 1: OAuth Flow */}
        {activeTab === "oauth" && (
          <div className="mt-4 flex flex-col gap-4 text-xs">
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200">
              <h3 className="font-bold text-slate-900 text-sm">Ủy quyền chính thức từ Pinterest</h3>
              <p className="mt-1 text-slate-600 leading-relaxed">
                Bấm nút bên dưới để mở trang đăng nhập Pinterest. Sau khi bạn chọn <strong>Authorize (Ủy quyền)</strong>, token sẽ được tự động đồng bộ về hệ thống FFP.
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleOpenOAuthPopup}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 font-bold text-white shadow-sm transition cursor-pointer"
                >
                  <span>Mở Cửa Sổ Ủy Quyền Pinterest</span>
                  <span>↗</span>
                </button>
              </div>
            </div>

            {/* Fallback code exchange */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-600">
              <label htmlFor="callback-input" className="font-bold text-slate-700 block mb-1 text-xs">
                Hoặc dán URL chuyển hướng / Mã Authorization Code nếu cửa sổ không tự đóng:
              </label>
              <div className="flex gap-2 mt-1">
                <input
                  id="callback-input"
                  type="text"
                  value={callbackUrlOrCode}
                  onChange={(e) => setCallbackUrlOrCode(e.target.value)}
                  placeholder="http://localhost:4000/api/v1/oauth/pinterest/callback?code=..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                />
                <button
                  type="button"
                  disabled={isSaving || !callbackUrlOrCode.trim()}
                  onClick={() => void handleExchangeCode()}
                  className="rounded-lg bg-slate-100 px-4 py-1.5 font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
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
              <label htmlFor="access-token-input" className="font-bold text-slate-700 block mb-1">
                Pinterest Access Token <span className="text-rose-700">*</span>:
              </label>
              <input
                id="access-token-input"
                type="password"
                value={manualAccessToken}
                onChange={(e) => setManualAccessToken(e.target.value)}
                placeholder="pina_HAA..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 font-mono focus:border-rose-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
              />
              <span className="text-xs text-slate-500 mt-1 block">
                Token được tạo từ Pinterest Developer Portal (App 1595071 &gt; Generate Token).
              </span>
            </div>

            <div>
              <label htmlFor="refresh-token-input" className="font-bold text-slate-700 block mb-1">
                Refresh Token (Tùy chọn - để tự động gia hạn):
              </label>
              <input
                id="refresh-token-input"
                type="password"
                value={manualRefreshToken}
                onChange={(e) => setManualRefreshToken(e.target.value)}
                placeholder="pinr_..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 font-mono focus:border-rose-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
              />
            </div>

            <div className="pt-2">
              <button
                type="button"
                disabled={isSaving || !manualAccessToken.trim()}
                onClick={() => void handleSaveManualToken()}
                className="rounded-lg bg-rose-600 px-5 py-2 font-bold text-white shadow hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? "Đang kiểm tra & lưu..." : "Kiểm tra & Lưu Token"}
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Browser Session */}
        {activeTab === "browser" && (
          <div className="mt-4 flex flex-col gap-4 text-xs">
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200">
              <h3 className="font-bold text-slate-900 text-sm">Phiên Pinterest trên máy Crawler Agent</h3>
              <p className="mt-1 text-slate-600 leading-relaxed">
                Phiên trình duyệt phải được tạo trên chính máy đang chạy Crawler Agent. Nhấp chuột phải biểu tượng FFP cạnh đồng hồ Windows, sau đó chọn <strong>Đăng nhập Pinterest</strong>.
              </p>
              <div className="mt-3 rounded-lg border border-slate-300 bg-white p-3">
                <p className="mb-2 font-semibold text-slate-700">Lệnh dự phòng nếu máy chưa có menu khay hệ thống:</p>
                <code className="block overflow-x-auto whitespace-nowrap text-xs text-blue-700">{agentLoginCommand}</code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(agentLoginCommand)}
                  className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Sao chép lệnh đăng nhập Agent
                </button>
                <p className="mt-2 text-xs text-slate-500">Agent phiên bản mới tự cập nhật trạng thái lên Coordinator trong khoảng 10 giây, không cần restart.</p>
              </div>

              {(isBrowserActive || authStatus?.browser_process_active) && (
                <div className="mt-3 rounded-lg border border-blue-300 bg-blue-50 p-3.5 text-blue-700 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2 font-bold text-blue-700">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-600 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" />
                    </span>
                    <span>Cửa sổ Chromium đang hoạt động trên màn hình!</span>
                  </div>
                  <p className="mt-1.5 text-slate-700 text-xs leading-relaxed">
                    Vui lòng kiểm tra cửa sổ Chromium (biểu tượng trình duyệt trên thanh Dock / Taskbar).
                    Hãy hoàn tất <strong>đăng nhập tài khoản Pinterest</strong> của bạn tại đó.
                  </p>
                  <p className="mt-1 text-xs text-blue-700 font-semibold">
                    <AppIcon name="info" /> Cửa sổ sẽ tự động đóng và hệ thống sẽ lập tức cập nhật trạng thái khi đăng nhập thành công.
                  </p>
                </div>
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  disabled={true}
                  onClick={() => {
                    setIsBrowserActive(true);
                    setFeedback(null);
                    onLaunchBrowserLogin();
                  }}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {(isLoggingIn || isBrowserActive || (authStatus?.browser_process_active ?? false)) && (
                    <svg className="animate-spin h-3.5 w-3.5 text-slate-900" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  <span>
                    {isBrowserActive || (authStatus?.browser_process_active ?? false)
                      ? "Cửa sổ đang mở • Chờ đăng nhập..."
                      : isLoggingIn
                      ? "Đang mở Chromium..."
                      : "Đăng nhập trực tiếp trên máy Agent"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void onRefreshStatus()}
                  className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 font-semibold text-slate-900 hover:bg-slate-100 cursor-pointer"
                >
                  Kiểm tra lại trạng thái
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 flex justify-end border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
