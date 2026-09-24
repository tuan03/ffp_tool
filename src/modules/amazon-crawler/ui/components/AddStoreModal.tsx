import { useState } from "react";

export interface AddedStoreInfo {
  readonly storeId: string;
  readonly shopDomain: string;
  readonly productTypes?: readonly string[];
  readonly defaultProductType?: string;
}

export interface AddStoreModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onStoreAdded: (store: AddedStoreInfo) => void;
}

export function AddStoreModal({ isOpen, onClose, onStoreAdded }: AddStoreModalProps): React.JSX.Element | null {
  const [storeId, setStoreId] = useState("");
  const [shopDomain, setShopDomain] = useState("");
  const [productTypesInput, setProductTypesInput] = useState("");
  const [authType, setAuthType] = useState<"client_credentials" | "static_access_token">("client_credentials");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [enableProxy, setEnableProxy] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyUsername, setProxyUsername] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");
  const [showProxyPassword, setShowProxyPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyCheckResult, setProxyCheckResult] = useState<{
    success: boolean;
    ip?: string;
    country?: string;
    latencyMs?: number;
    error?: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  if (!isOpen) return null;

  function resetForm(): void {
    setStoreId("");
    setShopDomain("");
    setProductTypesInput("");
    setClientId("");
    setClientSecret("");
    setAccessToken("");
    setEnableProxy(false);
    setProxyUrl("");
    setProxyUsername("");
    setProxyPassword("");
    setStatusMessage(null);
    setProxyCheckResult(null);
    setIsTestingProxy(false);
  }

  function handleClose(): void {
    if (isLoading || isTesting || isTestingProxy) return;
    resetForm();
    onClose();
  }

  async function handleCheckProxy(): Promise<void> {
    const trimmedProxy = proxyUrl.trim();
    if (!trimmedProxy) {
      setProxyCheckResult({
        success: false,
        error: "Vui lòng nhập Proxy URL trước khi kiểm tra.",
      });
      return;
    }

    setIsTestingProxy(true);
    setProxyCheckResult(null);

    try {
      const res = await fetch("/api/proxy/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedProxy,
          username: proxyUsername.trim() || undefined,
          password: proxyPassword.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setProxyCheckResult({
          success: false,
          latencyMs: data.data?.latencyMs,
          error: data.error?.message || "Kiểm tra proxy thất bại.",
        });
        return;
      }

      setProxyCheckResult({
        success: true,
        ip: data.data.ip,
        country: data.data.country,
        latencyMs: data.data.latencyMs,
      });
    } catch (err: unknown) {
      setProxyCheckResult({
        success: false,
        error: err instanceof Error ? err.message : "Lỗi mạng khi kiểm tra proxy.",
      });
    } finally {
      setIsTestingProxy(false);
    }
  }

  function buildPayload(testOnly: boolean) {
    const trimmedId = storeId.trim().toLowerCase();
    const trimmedDomain = shopDomain.trim().toLowerCase();

    const auth =
      authType === "client_credentials"
        ? {
            type: "client_credentials",
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
          }
        : {
            type: "static_access_token",
            accessToken: accessToken.trim(),
          };

    const proxy =
      enableProxy && proxyUrl.trim()
        ? {
            url: proxyUrl.trim(),
            username: proxyUsername.trim() || undefined,
            password: proxyPassword.trim() || undefined,
            failClosed: true,
          }
        : undefined;

    const parsedProductTypes = productTypesInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      storeId: trimmedId,
      shopDomain: trimmedDomain,
      auth,
      proxy,
      testOnly,
      productTypes: parsedProductTypes.length > 0 ? parsedProductTypes : undefined,
      defaultProductType: parsedProductTypes.length > 0 ? parsedProductTypes[0] : undefined,
    };
  }

  function validateInput(): string | null {
    if (!storeId.trim()) return "Vui lòng nhập Store ID (ví dụ: dizzy).";
    if (!shopDomain.trim()) return "Vui lòng nhập Shopify Domain (ví dụ: dizzy.myshopify.com).";
    if (authType === "client_credentials") {
      if (!clientId.trim()) return "Vui lòng nhập Client ID từ Shopify Partner App.";
      if (!clientSecret.trim()) return "Vui lòng nhập Client Secret từ Shopify Partner App.";
    } else {
      if (!accessToken.trim()) return "Vui lòng nhập Access Token (shpat_...).";
    }
    if (enableProxy && !proxyUrl.trim()) {
      return "Vui lòng nhập Proxy URL khi đã bật cấu hình Proxy.";
    }
    return null;
  }

  async function handleTestConnection(): Promise<void> {
    const errorMsg = validateInput();
    if (errorMsg) {
      setStatusMessage({ type: "error", text: errorMsg });
      return;
    }

    setIsTesting(true);
    setStatusMessage(null);

    try {
      const payload = buildPayload(true);
      const res = await fetch("/api/stores/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Kiểm tra kết nối thất bại.");
      }

      const discovered = (data.data?.productTypes as string[]) || [];
      const discoveredText =
        discovered.length > 0
          ? ` (Đã quét được ${discovered.length} loại SP: ${discovered.slice(0, 4).join(", ")}${discovered.length > 4 ? "..." : ""})`
          : "";

      setStatusMessage({
        type: "success",
        text: `✓ Kết nối thành công tới ${data.data?.shopDomain || shopDomain}! Thông tin xác thực hợp lệ.${discoveredText}`,
      });

      if (!productTypesInput.trim() && discovered.length > 0) {
        setProductTypesInput(discovered.join(", "));
      }
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Không thể kết nối với Shopify.",
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    const errorMsg = validateInput();
    if (errorMsg) {
      setStatusMessage({ type: "error", text: errorMsg });
      return;
    }

    setIsLoading(true);
    setStatusMessage(null);

    try {
      const payload = buildPayload(false);
      const res = await fetch("/api/stores/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Đăng ký store thất bại.");
      }

      const registeredStore = data.data?.store;
      const finalStoreId = registeredStore?.storeId || storeId.trim().toLowerCase();
      const finalShopDomain = registeredStore?.shopDomain || shopDomain.trim().toLowerCase();
      const parsedTypes = productTypesInput.split(",").map((s) => s.trim()).filter(Boolean);
      const finalProductTypes =
        registeredStore?.productTypes || (parsedTypes.length > 0 ? parsedTypes : undefined);
      const finalDefaultType = registeredStore?.defaultProductType || finalProductTypes?.[0];

      resetForm();
      onStoreAdded({
        storeId: finalStoreId,
        shopDomain: finalShopDomain,
        productTypes: finalProductTypes,
        defaultProductType: finalDefaultType,
      });
      onClose();
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Đăng ký store thất bại.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-100">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 font-bold border border-cyan-500/30 text-sm">
                🏬
              </span>
              <h3 className="text-lg font-bold text-slate-100">Thêm &amp; Kết nối Shopify Store mới</h3>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Nhập thông tin xác thực để kết nối trực tiếp với Shopify qua Gateway và lưu vào cấu hình hệ thống.
            </p>
          </div>
          <button
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-50"
            disabled={isLoading || isTesting}
            type="button"
            onClick={handleClose}
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          {/* Store ID & Domain */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium text-slate-300">
              <span>
                Store ID <span className="text-rose-400">*</span>
              </span>
              <input
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                disabled={isLoading || isTesting}
                placeholder="vd: dizzy"
                required
                type="text"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              />
              <span className="text-[10px] text-slate-500">Mã định danh duy nhất (chữ thường, số, dấu gạch)</span>
            </label>

            <label className="grid gap-1 text-xs font-medium text-slate-300">
              <span>
                Shopify Domain <span className="text-rose-400">*</span>
              </span>
              <input
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                disabled={isLoading || isTesting}
                placeholder="vd: dizzy.myshopify.com"
                required
                type="text"
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
              />
              <span className="text-[10px] text-slate-500">Domain hoặc link admin myshopify</span>
            </label>
          </div>

          {/* Product Types / Niche */}
          <label className="grid gap-1 text-xs font-medium text-slate-300">
            <span className="flex items-center justify-between">
              <span>Loại sản phẩm chính (Niche / Product Types)</span>
              <span className="text-[11px] font-normal text-slate-500">Tùy chọn</span>
            </span>
            <input
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-sans"
              disabled={isLoading || isTesting}
              placeholder="vd: Blanket, Quilt, Bedding Set (hoặc Rug, Doormat...)"
              type="text"
              value={productTypesInput}
              onChange={(e) => setProductTypesInput(e.target.value)}
            />
            <span className="text-[10px] text-slate-500">
              Nhập các loại SP phân cách bằng dấu phẩy. Bỏ trống để hệ thống tự động quét từ Shopify.
            </span>
          </label>

          {/* Authentication Type */}
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">Phương thức xác thực</span>
              <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setAuthType("client_credentials")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    authType === "client_credentials"
                      ? "bg-cyan-500 text-slate-950 font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Client Credentials
                </button>
                <button
                  type="button"
                  onClick={() => setAuthType("static_access_token")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    authType === "static_access_token"
                      ? "bg-cyan-500 text-slate-950 font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Access Token (shpat)
                </button>
              </div>
            </div>

            {authType === "client_credentials" ? (
              <div className="space-y-3 pt-1">
                <label className="grid gap-1 text-xs font-medium text-slate-300">
                  <span>
                    Client ID <span className="text-rose-400">*</span>
                  </span>
                  <input
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                    disabled={isLoading || isTesting}
                    placeholder="Shopify App Client ID"
                    required
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                </label>

                <label className="grid gap-1 text-xs font-medium text-slate-300">
                  <span className="flex items-center justify-between">
                    <span>
                      Client Secret <span className="text-rose-400">*</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSecret((prev) => !prev)}
                      className="text-[11px] text-cyan-400 hover:underline"
                    >
                      {showSecret ? "Ẩn secret" : "Hiện secret"}
                    </button>
                  </span>
                  <input
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                    disabled={isLoading || isTesting}
                    placeholder="Shopify App Client Secret"
                    required
                    type={showSecret ? "text" : "password"}
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                  <span className="text-[10px] text-slate-500">
                    Gateway sẽ tự động xin token OAuth và gia hạn định kỳ 24h.
                  </span>
                </label>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <label className="grid gap-1 text-xs font-medium text-slate-300">
                  <span className="flex items-center justify-between">
                    <span>
                      Access Token <span className="text-rose-400">*</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSecret((prev) => !prev)}
                      className="text-[11px] text-cyan-400 hover:underline"
                    >
                      {showSecret ? "Ẩn token" : "Hiện token"}
                    </button>
                  </span>
                  <input
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                    disabled={isLoading || isTesting}
                    placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxxxx"
                    required
                    type={showSecret ? "text" : "password"}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                  />
                  <span className="text-[10px] text-slate-500">
                    Chỉ dùng cho Custom App có token tĩnh vĩnh viễn (bắt đầu bằng shpat_). Nếu bạn dùng App Partner thông thường (Client ID &amp; Secret), hãy chọn tab Client Credentials ở trên để Gateway tự động xin và làm mới token định kỳ.
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Proxy Configuration (Optional) */}
          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-300">
                <input
                  checked={enableProxy}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                  type="checkbox"
                  onChange={(e) => setEnableProxy(e.target.checked)}
                />
                <span>Sử dụng Proxy cho store này (Khuyên dùng)</span>
              </label>
              <span className="text-[11px] font-mono text-slate-500">Tùy chọn</span>
            </div>

            {enableProxy && (
              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-300">Proxy Server URL</span>
                    <button
                      type="button"
                      disabled={isTestingProxy || isLoading || isTesting || !proxyUrl.trim()}
                      onClick={handleCheckProxy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                      title="Kiểm tra kết nối và đo ping proxy"
                    >
                      {isTestingProxy ? (
                        <>
                          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                          <span>Đang kiểm tra...</span>
                        </>
                      ) : (
                        <>
                          <span>⚡</span>
                          <span>Kiểm tra Proxy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <input
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                    disabled={isLoading || isTesting || isTestingProxy}
                    placeholder="http://us-proxy.example.com:8080"
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => {
                      setProxyUrl(e.target.value);
                      if (proxyCheckResult) setProxyCheckResult(null);
                    }}
                  />
                </div>

                {/* Proxy Check Result Banner */}
                {proxyCheckResult && (
                  <div
                    className={`rounded-lg p-2.5 text-xs flex items-start gap-2 border transition-all ${
                      proxyCheckResult.success
                        ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                        : "bg-rose-950/40 border-rose-500/40 text-rose-300"
                    }`}
                  >
                    <span className="text-sm leading-none mt-0.5">
                      {proxyCheckResult.success ? "✅" : "❌"}
                    </span>
                    <div className="flex-1 space-y-0.5">
                      {proxyCheckResult.success ? (
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="font-semibold text-emerald-200">Proxy hoạt động tốt!</span>
                          {proxyCheckResult.latencyMs !== undefined && (
                            <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300 border border-emerald-700/50">
                              Ping: {proxyCheckResult.latencyMs} ms
                            </span>
                          )}
                          {proxyCheckResult.ip && (
                            <span className="font-mono text-white text-[11px]">
                              IP xuất ra: {proxyCheckResult.ip}
                              {proxyCheckResult.country ? ` (${proxyCheckResult.country})` : ""}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div>
                          <span className="font-semibold">Lỗi kết nối proxy: </span>
                          <span>{proxyCheckResult.error}</span>
                          {proxyCheckResult.latencyMs !== undefined && (
                            <span className="ml-1 text-[11px] text-rose-400 font-mono">
                              ({proxyCheckResult.latencyMs} ms)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-medium text-slate-300">
                    <span>Proxy Username</span>
                    <input
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                      disabled={isLoading || isTesting}
                      placeholder="username (nếu có)"
                      type="text"
                      value={proxyUsername}
                      onChange={(e) => setProxyUsername(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-slate-300">
                    <span className="flex items-center justify-between">
                      <span>Proxy Password</span>
                      <button
                        type="button"
                        onClick={() => setShowProxyPassword((prev) => !prev)}
                        className="text-[10px] text-cyan-400 hover:underline"
                      >
                        {showProxyPassword ? "Ẩn" : "Hiện"}
                      </button>
                    </span>
                    <input
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                      disabled={isLoading || isTesting}
                      placeholder="password (nếu có)"
                      type={showProxyPassword ? "text" : "password"}
                      value={proxyPassword}
                      onChange={(e) => setProxyPassword(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div
              className={`rounded-xl border p-3.5 text-xs ${
                statusMessage.type === "success"
                  ? "border-emerald-600/60 bg-emerald-950/40 text-emerald-200"
                  : "border-rose-600/60 bg-rose-950/40 text-rose-200"
              }`}
            >
              <p className="font-semibold">{statusMessage.type === "success" ? "Thành công" : "Lỗi kết nối"}</p>
              <p className="mt-0.5 leading-relaxed">{statusMessage.text}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
            <button
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
              disabled={isLoading || isTesting}
              type="button"
              onClick={handleTestConnection}
            >
              {isTesting ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-r-transparent" />
                  <span>Đang test...</span>
                </span>
              ) : (
                "Kiểm tra kết nối"
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                className="rounded-lg border border-slate-800 px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
                disabled={isLoading || isTesting}
                type="button"
                onClick={handleClose}
              >
                Hủy
              </button>
              <button
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-5 py-2 text-xs font-bold text-slate-950 shadow-md transition-colors disabled:opacity-50"
                disabled={isLoading || isTesting}
                type="submit"
              >
                {isLoading ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950 border-r-transparent" />
                    <span>Đang kết nối &amp; lưu...</span>
                  </>
                ) : (
                  <span>Kết nối &amp; Lưu Store</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
