import { useEffect, useState } from "react";

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
  readonly onStoreUpdated?: (store: AddedStoreInfo) => void;
  readonly editStoreId?: string | null;
}

export function AddStoreModal({
  isOpen,
  onClose,
  onStoreAdded,
  onStoreUpdated,
  editStoreId,
}: AddStoreModalProps): React.JSX.Element | null {
  const isEditMode = Boolean(editStoreId);

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
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [proxyCheckResult, setProxyCheckResult] = useState<{
    success: boolean;
    ip?: string;
    country?: string;
    latencyMs?: number;
    error?: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      resetForm();
      return;
    }
    if (!editStoreId) {
      resetForm();
      return;
    }

    let isMounted = true;
    async function loadStoreDetails() {
      setIsLoadingDetails(true);
      setStatusMessage(null);
      try {
        const res = await fetch(`/api/stores/get?storeId=${encodeURIComponent(editStoreId!)}`);
        const json = await res.json();
        if (isMounted && json.success && json.data?.store) {
          const s = json.data.store;
          setStoreId(s.storeId || editStoreId!);
          setShopDomain(s.shopDomain || "");
          setProductTypesInput(Array.isArray(s.productTypes) ? s.productTypes.join(", ") : "");
          setAuthType(s.authType === "static" ? "static_access_token" : "client_credentials");
          setClientId(s.clientId || "");
          setClientSecret("");
          setAccessToken("");
          setEnableProxy(Boolean(s.hasProxy || s.proxyUrl));
          setProxyUrl(s.proxyUrl || "");
          setProxyUsername(s.proxyUsername || "");
          setProxyPassword("");
          setProxyCheckResult(null);
        }
      } catch (err) {
        if (isMounted) {
          setStatusMessage({
            type: "error",
            text: err instanceof Error ? err.message : "Không tải được thông tin store.",
          });
        }
      } finally {
        if (isMounted) setIsLoadingDetails(false);
      }
    }
    void loadStoreDetails();
    return () => {
      isMounted = false;
    };
  }, [isOpen, editStoreId]);

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
    setIsLoadingDetails(false);
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

    let auth: Record<string, unknown> | undefined;
    if (isEditMode) {
      if (authType === "client_credentials") {
        if (clientId.trim() || clientSecret.trim()) {
          auth = {
            type: "client_credentials",
            clientId: clientId.trim() || undefined,
            clientSecret: clientSecret.trim() || undefined,
          };
        }
      } else {
        if (accessToken.trim()) {
          auth = {
            type: "static_access_token",
            accessToken: accessToken.trim(),
          };
        }
      }
    } else {
      auth =
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
    }

    const proxy = enableProxy
      ? proxyUrl.trim()
        ? {
            url: proxyUrl.trim(),
            username: proxyUsername.trim() || undefined,
            password: proxyPassword.trim() || undefined,
            failClosed: true,
          }
        : undefined
      : isEditMode
      ? null
      : undefined;

    const parsedProductTypes = productTypesInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      storeId: trimmedId,
      shopDomain: trimmedDomain || undefined,
      auth,
      proxy,
      testOnly,
      productTypes: parsedProductTypes.length > 0 ? parsedProductTypes : undefined,
      defaultProductType: parsedProductTypes.length > 0 ? parsedProductTypes[0] : undefined,
    };
  }

  function validateInput(): string | null {
    if (!storeId.trim()) return "Vui lòng nhập Store ID (ví dụ: dizzy).";
    if (!isEditMode && !shopDomain.trim()) return "Vui lòng nhập Shopify Domain (ví dụ: dizzy.myshopify.com).";

    if (!isEditMode) {
      if (authType === "client_credentials") {
        if (!clientId.trim()) return "Vui lòng nhập Client ID từ Shopify Partner App.";
        if (!clientSecret.trim()) return "Vui lòng nhập Client Secret từ Shopify Partner App.";
      } else {
        if (!accessToken.trim()) return "Vui lòng nhập Access Token (shpat_...).";
      }
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
      const endpoint = isEditMode ? "/api/stores/update" : "/api/stores/register";
      const res = await fetch(endpoint, {
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
      const endpoint = isEditMode ? "/api/stores/update" : "/api/stores/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || (isEditMode ? "Cập nhật store thất bại." : "Đăng ký store thất bại."));
      }

      const registeredStore = data.data?.store;
      const finalStoreId = registeredStore?.storeId || storeId.trim().toLowerCase();
      const finalShopDomain = registeredStore?.shopDomain || shopDomain.trim().toLowerCase();
      const parsedTypes = productTypesInput.split(",").map((s) => s.trim()).filter(Boolean);
      const finalProductTypes =
        registeredStore?.productTypes || (parsedTypes.length > 0 ? parsedTypes : undefined);
      const finalDefaultType = registeredStore?.defaultProductType || finalProductTypes?.[0];

      resetForm();
      if (isEditMode) {
        onStoreUpdated?.({
          storeId: finalStoreId,
          shopDomain: finalShopDomain,
          productTypes: finalProductTypes,
          defaultProductType: finalDefaultType,
        });
      } else {
        onStoreAdded({
          storeId: finalStoreId,
          shopDomain: finalShopDomain,
          productTypes: finalProductTypes,
          defaultProductType: finalDefaultType,
        });
      }
      onClose();
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : isEditMode ? "Không thể cập nhật store." : "Không thể đăng ký store.",
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
                {isEditMode ? "✏️" : "🏬"}
              </span>
              <h3 className="text-lg font-bold text-slate-100">
                {isEditMode ? "Chỉnh sửa Shopify Store" : "Thêm & Kết nối Shopify Store mới"}
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {isEditMode
                ? "Cập nhật ứng dụng Partner App, đổi Access Token hoặc thay đổi cấu hình Proxy"
                : "Nhập thông tin xác thực để kết nối trực tiếp với Shopify qua Gateway và lưu vào cấu hình hệ thống."}
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

        {isLoadingDetails ? (
          <div className="py-12 text-center text-sm text-slate-400">
            <svg className="mx-auto h-6 w-6 animate-spin text-cyan-400 mb-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Đang tải thông tin store...
          </div>
        ) : (
          <form
            className="mt-5 space-y-4"
            onSubmit={handleSubmit}
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
          >
            {/* Hidden dummy fields to capture aggressive browser autofill */}
            <input type="text" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" autoComplete="off" />
            <input type="password" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" autoComplete="new-password" />

            {/* Store ID & Domain */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-slate-300">
                <span>
                  Store ID <span className="text-rose-400">*</span>
                  {isEditMode && <span className="text-[10px] text-slate-500 font-normal ml-1">(Cố định)</span>}
                </span>
                <input
                  className={`rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono ${
                    isEditMode ? "opacity-60 cursor-not-allowed bg-slate-900" : ""
                  }`}
                  disabled={isLoading || isTesting || isEditMode}
                  placeholder="vd: dizzy"
                  required
                  type="text"
                  name="ffp_new_store_id"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
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
                  name="ffp_new_shop_domain"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
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
                Phân cách bằng dấu phẩy. Nếu để trống, hệ thống sẽ tự động quét từ store khi kiểm tra kết nối.
              </span>
            </label>

            {/* Auth Type Tabs */}
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <label className="text-xs font-semibold text-slate-300">Phương thức xác thực Shopify</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAuthType("client_credentials")}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-all ${
                    authType === "client_credentials"
                      ? "border-cyan-500/60 bg-cyan-950/30 text-cyan-200 shadow-sm"
                      : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-300"
                  }`}
                >
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <span>🔑 Client Credentials</span>
                    <span className="rounded bg-cyan-500/20 px-1 py-0.2 text-[9px] text-cyan-300 font-normal">
                      Khuyên dùng
                    </span>
                  </span>
                  <span className="text-[11px] text-slate-400 leading-tight">
                    Tự động cấp & gia hạn token qua Partner App (không bao giờ hết hạn).
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setAuthType("static_access_token")}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-all ${
                    authType === "static_access_token"
                      ? "border-cyan-500/60 bg-cyan-950/30 text-cyan-200 shadow-sm"
                      : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-300"
                  }`}
                >
                  <span className="text-xs font-bold">🎫 Static Access Token</span>
                  <span className="text-[11px] text-slate-400 leading-tight">
                    Dùng Admin API token tĩnh (bắt đầu bằng shpat_...).
                  </span>
                </button>
              </div>

              {/* Client Credentials Inputs */}
              {authType === "client_credentials" ? (
                <div className="space-y-2.5 pt-2">
                  <label className="grid gap-1 text-xs font-medium text-slate-300">
                    <span>
                      Client ID {!isEditMode && <span className="text-rose-400">*</span>}
                    </span>
                    <input
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                      disabled={isLoading || isTesting}
                      placeholder={isEditMode ? "Giữ nguyên Client ID cũ nếu không đổi" : "Client ID từ Partner App"}
                      type="text"
                      name="ffp_shopify_client_id"
                      autoComplete="off"
                      data-lpignore="true"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-medium text-slate-300">
                    <span>
                      Client Secret {!isEditMode && <span className="text-rose-400">*</span>}
                      {isEditMode && <span className="text-[10px] text-slate-500 font-normal ml-1">(Để trống nếu giữ nguyên bí mật cũ)</span>}
                    </span>
                    <div className="relative">
                      <input
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-10 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                        disabled={isLoading || isTesting}
                        placeholder={isEditMode ? "•••••••• (để trống nếu giữ nguyên bí mật cũ)" : "Client Secret từ Partner App"}
                        type={showSecret ? "text" : "password"}
                        name="ffp_shopify_client_secret"
                        autoComplete="new-password"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret(!showSecret)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
                      >
                        {showSecret ? "🙈" : "👁️"}
                      </button>
                    </div>
                  </label>
                </div>
              ) : (
                /* Static Token Input */
                <div className="pt-2">
                  <label className="grid gap-1 text-xs font-medium text-slate-300">
                    <span>
                      Admin API Access Token {!isEditMode && <span className="text-rose-400">*</span>}
                      {isEditMode && <span className="text-[10px] text-slate-500 font-normal ml-1">(Để trống nếu giữ nguyên token cũ)</span>}
                    </span>
                    <div className="relative">
                      <input
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-10 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                        disabled={isLoading || isTesting}
                        placeholder={isEditMode ? "•••••••• (để trống nếu giữ nguyên token cũ)" : "shpat_xxxxxxxxxxxxxxxxxxxxxxxx"}
                        type={showSecret ? "text" : "password"}
                        name="ffp_shopify_access_token"
                        autoComplete="new-password"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret(!showSecret)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
                      >
                        {showSecret ? "🙈" : "👁️"}
                      </button>
                    </div>
                  </label>
                </div>
              )}
            </div>

            {/* Proxy Section */}
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <span>🌐 Proxy riêng cho Store</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 font-normal">
                      Khuyên dùng cho Multi-Store
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Mỗi store một IP proxy riêng biệt chống liên kết tài khoản (Fail-closed policy).
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={enableProxy}
                  onChange={(e) => setEnableProxy(e.target.checked)}
                  disabled={isLoading || isTesting}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-400 cursor-pointer"
                />
              </div>

              {enableProxy && (
                <div className="space-y-2.5 pt-1 border-t border-slate-800/80">
                  <label className="grid gap-1 text-xs font-medium text-slate-300">
                    <span>
                      Proxy URL <span className="text-rose-400">*</span>
                    </span>
                    <input
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                      disabled={isLoading || isTesting}
                      placeholder="vd: http://123.45.67.89:8080"
                      type="text"
                      name="ffp_proxy_url"
                      autoComplete="off"
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-medium text-slate-300">
                      <span>Proxy Username (tùy chọn)</span>
                      <input
                        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                        disabled={isLoading || isTesting}
                        placeholder="username"
                        type="text"
                        name="ffp_proxy_username"
                        autoComplete="off"
                        data-lpignore="true"
                        value={proxyUsername}
                        onChange={(e) => setProxyUsername(e.target.value)}
                      />
                    </label>

                    <label className="grid gap-1 text-xs font-medium text-slate-300">
                      <span>
                        Proxy Password (tùy chọn)
                        {isEditMode && <span className="text-[10px] text-slate-500 font-normal ml-1">(Để trống nếu giữ mật khẩu cũ)</span>}
                      </span>
                      <div className="relative">
                        <input
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-10 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                          disabled={isLoading || isTesting}
                          placeholder={isEditMode ? "•••••••• (để trống nếu giữ nguyên mật khẩu cũ)" : "password"}
                          type={showProxyPassword ? "text" : "password"}
                          name="ffp_proxy_password"
                          autoComplete="new-password"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          value={proxyPassword}
                          onChange={(e) => setProxyPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowProxyPassword(!showProxyPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
                        >
                          {showProxyPassword ? "🙈" : "👁️"}
                        </button>
                      </div>
                    </label>
                  </div>

                  {/* Live Check Proxy Button & Result */}
                  <div className="pt-1.5 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCheckProxy()}
                      disabled={isLoading || isTesting || isTestingProxy || !proxyUrl.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-400 disabled:opacity-50 transition-all shadow-sm"
                    >
                      {isTestingProxy ? (
                        <>
                          <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          <span>Đang kiểm tra proxy...</span>
                        </>
                      ) : (
                        <>
                          <span>⚡ Kiểm tra Proxy</span>
                        </>
                      )}
                    </button>

                    {proxyCheckResult && (
                      <div
                        className={`text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 ${
                          proxyCheckResult.success
                            ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
                            : "bg-rose-950/40 border-rose-500/30 text-rose-300"
                        }`}
                      >
                        {proxyCheckResult.success ? (
                          <>
                            <span>✓ IP: {proxyCheckResult.ip}</span>
                            {proxyCheckResult.country && <span>({proxyCheckResult.country})</span>}
                            {proxyCheckResult.latencyMs !== undefined && (
                              <span className="font-mono text-emerald-400">· {proxyCheckResult.latencyMs}ms</span>
                            )}
                          </>
                        ) : (
                          <>
                            <span>✕ {proxyCheckResult.error || "Proxy không kết nối được"}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Status Message */}
            {statusMessage && (
              <div
                className={`rounded-xl border p-3 text-xs leading-relaxed ${
                  statusMessage.type === "success"
                    ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300"
                    : "border-rose-500/40 bg-rose-950/30 text-rose-300"
                }`}
              >
                {statusMessage.text}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={isLoading || isTesting || isTestingProxy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-50 transition-colors"
              >
                {isTesting ? (
                  <>
                    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Đang kiểm tra kết nối...</span>
                  </>
                ) : (
                  <span>🔌 Kiểm tra kết nối</span>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isLoading || isTesting}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isLoading || isTesting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {isLoading ? (
                    <>
                      <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>{isEditMode ? "Đang lưu thay đổi..." : "Đang lưu..."}</span>
                    </>
                  ) : (
                    <span>{isEditMode ? "Lưu thay đổi" : "Lưu Store"}</span>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
