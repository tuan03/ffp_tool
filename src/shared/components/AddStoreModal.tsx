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
            text: err instanceof Error ? err.message : "Kh├┤ng tß║úi ─æã░ß╗úc th├┤ng tin store.",
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
        error: "Vui l├▓ng nhß║¡p Proxy URL trã░ß╗øc khi kiß╗âm tra.",
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
          error: data.error?.message || "Kiß╗âm tra proxy thß║Ñt bß║íi.",
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
        error: err instanceof Error ? err.message : "Lß╗ùi mß║íng khi kiß╗âm tra proxy.",
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
    if (!storeId.trim()) return "Vui l├▓ng nhß║¡p Store ID (v├¡ dß╗Ñ: dizzy).";
    if (!isEditMode && !shopDomain.trim()) return "Vui l├▓ng nhß║¡p Shopify Domain (v├¡ dß╗Ñ: dizzy.myshopify.com).";

    if (!isEditMode) {
      if (authType === "client_credentials") {
        if (!clientId.trim()) return "Vui l├▓ng nhß║¡p Client ID tß╗½ Shopify Partner App.";
        if (!clientSecret.trim()) return "Vui l├▓ng nhß║¡p Client Secret tß╗½ Shopify Partner App.";
      } else {
        if (!accessToken.trim()) return "Vui l├▓ng nhß║¡p Access Token (shpat_...).";
      }
    }

    if (enableProxy && !proxyUrl.trim()) {
      return "Vui l├▓ng nhß║¡p Proxy URL khi ─æ├ú bß║¡t cß║Ñu h├¼nh Proxy.";
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
        throw new Error(data.error?.message || "Kiß╗âm tra kß║┐t nß╗æi thß║Ñt bß║íi.");
      }

      const discovered = (data.data?.productTypes as string[]) || [];
      const discoveredText =
        discovered.length > 0
          ? ` (─É├ú qu├®t ─æã░ß╗úc ${discovered.length} loß║íi SP: ${discovered.slice(0, 4).join(", ")}${discovered.length > 4 ? "..." : ""})`
          : "";

      setStatusMessage({
        type: "success",
        text: `Ô£ô Kß║┐t nß╗æi th├ánh c├┤ng tß╗øi ${data.data?.shopDomain || shopDomain}! Th├┤ng tin x├íc thß╗▒c hß╗úp lß╗ç.${discoveredText}`,
      });

      if (!productTypesInput.trim() && discovered.length > 0) {
        setProductTypesInput(discovered.join(", "));
      }
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Kh├┤ng thß╗â kß║┐t nß╗æi vß╗øi Shopify.",
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
        throw new Error(data.error?.message || (isEditMode ? "Cß║¡p nhß║¡t store thß║Ñt bß║íi." : "─É─âng k├¢ store thß║Ñt bß║íi."));
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
        text: err instanceof Error ? err.message : isEditMode ? "Kh├┤ng thß╗â cß║¡p nhß║¡t store." : "Kh├┤ng thß╗â ─æ─âng k├¢ store.",
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
                {isEditMode ? "Ô£Å´©Å" : "­ƒÅ¼"}
              </span>
              <h3 className="text-lg font-bold text-slate-100">
                {isEditMode ? "Chß╗ënh sß╗¡a Shopify Store" : "Th├¬m & Kß║┐t nß╗æi Shopify Store mß╗øi"}
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {isEditMode
                ? "Cß║¡p nhß║¡t ß╗®ng dß╗Ñng Partner App, ─æß╗òi Access Token hoß║Àc thay ─æß╗òi cß║Ñu h├¼nh Proxy"
                : "Nhß║¡p th├┤ng tin x├íc thß╗▒c ─æß╗â kß║┐t nß╗æi trß╗▒c tiß║┐p vß╗øi Shopify qua Gateway v├á lã░u v├áo cß║Ñu h├¼nh hß╗ç thß╗æng."}
            </p>
          </div>
          <button
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-50"
            disabled={isLoading || isTesting}
            type="button"
            onClick={handleClose}
          >
            Ô£ò
          </button>
        </div>

        {isLoadingDetails ? (
          <div className="py-12 text-center text-sm text-slate-400">
            <svg className="mx-auto h-6 w-6 animate-spin text-cyan-400 mb-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            ─Éang tß║úi th├┤ng tin store...
          </div>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            {/* Store ID & Domain */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-slate-300">
                <span>
                  Store ID <span className="text-rose-400">*</span>
                  {isEditMode && <span className="text-[10px] text-slate-500 font-normal ml-1">(Cß╗æ ─æß╗ïnh)</span>}
                </span>
                <input
                  className={`rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono ${
                    isEditMode ? "opacity-60 cursor-not-allowed bg-slate-900" : ""
                  }`}
                  disabled={isLoading || isTesting || isEditMode}
                  placeholder="vd: dizzy"
                  required
                  type="text"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                />
                <span className="text-[10px] text-slate-500">M├ú ─æß╗ïnh danh duy nhß║Ñt (chß╗» thã░ß╗Øng, sß╗æ, dß║Ñu gß║ích)</span>
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
                <span className="text-[10px] text-slate-500">Domain hoß║Àc link admin myshopify</span>
              </label>
            </div>

            {/* Product Types / Niche */}
            <label className="grid gap-1 text-xs font-medium text-slate-300">
              <span className="flex items-center justify-between">
                <span>Loß║íi sß║ún phß║®m ch├¡nh (Niche / Product Types)</span>
                <span className="text-[11px] font-normal text-slate-500">T├╣y chß╗ìn</span>
              </span>
              <input
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-sans"
                disabled={isLoading || isTesting}
                placeholder="vd: Blanket, Quilt, Bedding Set (hoß║Àc Rug, Doormat...)"
                type="text"
                value={productTypesInput}
                onChange={(e) => setProductTypesInput(e.target.value)}
              />
              <span className="text-[10px] text-slate-500">
                Ph├ón c├ích bß║▒ng dß║Ñu phß║®y. Nß║┐u ─æß╗â trß╗æng, hß╗ç thß╗æng sß║¢ tß╗▒ ─æß╗Öng qu├®t tß╗½ store khi kiß╗âm tra kß║┐t nß╗æi.
              </span>
            </label>

            {/* Auth Type Tabs */}
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <label className="text-xs font-semibold text-slate-300">Phã░ãíng thß╗®c x├íc thß╗▒c Shopify</label>
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
                    <span>­ƒöæ Client Credentials</span>
                    <span className="rounded bg-cyan-500/20 px-1 py-0.2 text-[9px] text-cyan-300 font-normal">
                      Khuy├¬n d├╣ng
                    </span>
                  </span>
                  <span className="text-[11px] text-slate-400 leading-tight">
                    Tß╗▒ ─æß╗Öng cß║Ñp & gia hß║ín token qua Partner App (kh├┤ng bao giß╗Ø hß║┐t hß║ín).
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
                  <span className="text-xs font-bold">­ƒÄ½ Static Access Token</span>
                  <span className="text-[11px] text-slate-400 leading-tight">
                    D├╣ng Admin API token t─®nh (bß║»t ─æß║ºu bß║▒ng shpat_...).
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
                      placeholder={isEditMode ? "Giß╗» nguy├¬n Client ID c┼® nß║┐u kh├┤ng ─æß╗òi" : "Client ID tß╗½ Partner App"}
                      type="text"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-medium text-slate-300">
                    <span>
                      Client Secret {!isEditMode && <span className="text-rose-400">*</span>}
                      {isEditMode && <span className="text-[10px] text-slate-500 font-normal ml-1">(─Éß╗â trß╗æng nß║┐u giß╗» nguy├¬n b├¡ mß║¡t c┼®)</span>}
                    </span>
                    <div className="relative">
                      <input
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-10 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                        disabled={isLoading || isTesting}
                        placeholder={isEditMode ? "ÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇó (─æß╗â trß╗æng nß║┐u giß╗» nguy├¬n b├¡ mß║¡t c┼®)" : "Client Secret tß╗½ Partner App"}
                        type={showSecret ? "text" : "password"}
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret(!showSecret)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
                      >
                        {showSecret ? "­ƒÖê" : "­ƒæü´©Å"}
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
                      {isEditMode && <span className="text-[10px] text-slate-500 font-normal ml-1">(─Éß╗â trß╗æng nß║┐u giß╗» nguy├¬n token c┼®)</span>}
                    </span>
                    <div className="relative">
                      <input
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-10 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                        disabled={isLoading || isTesting}
                        placeholder={isEditMode ? "ÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇó (─æß╗â trß╗æng nß║┐u giß╗» nguy├¬n token c┼®)" : "shpat_xxxxxxxxxxxxxxxxxxxxxxxx"}
                        type={showSecret ? "text" : "password"}
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret(!showSecret)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
                      >
                        {showSecret ? "­ƒÖê" : "­ƒæü´©Å"}
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
                    <span>­ƒîÉ Proxy ri├¬ng cho Store</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 font-normal">
                      Khuy├¬n d├╣ng cho Multi-Store
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Mß╗ùi store mß╗Öt IP proxy ri├¬ng biß╗çt chß╗æng li├¬n kß║┐t t├ái khoß║ún (Fail-closed policy).
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
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-medium text-slate-300">
                      <span>Proxy Username (t├╣y chß╗ìn)</span>
                      <input
                        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                        disabled={isLoading || isTesting}
                        placeholder="username"
                        type="text"
                        value={proxyUsername}
                        onChange={(e) => setProxyUsername(e.target.value)}
                      />
                    </label>

                    <label className="grid gap-1 text-xs font-medium text-slate-300">
                      <span>
                        Proxy Password (t├╣y chß╗ìn)
                        {isEditMode && <span className="text-[10px] text-slate-500 font-normal ml-1">(─Éß╗â trß╗æng nß║┐u giß╗» mß║¡t khß║®u c┼®)</span>}
                      </span>
                      <div className="relative">
                        <input
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-10 text-sm text-slate-100 outline-none focus:border-cyan-400 font-mono"
                          disabled={isLoading || isTesting}
                          placeholder={isEditMode ? "ÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇó (─æß╗â trß╗æng nß║┐u giß╗» nguy├¬n mß║¡t khß║®u c┼®)" : "password"}
                          type={showProxyPassword ? "text" : "password"}
                          value={proxyPassword}
                          onChange={(e) => setProxyPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowProxyPassword(!showProxyPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
                        >
                          {showProxyPassword ? "­ƒÖê" : "­ƒæü´©Å"}
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
                          <span>─Éang kiß╗âm tra proxy...</span>
                        </>
                      ) : (
                        <>
                          <span>ÔÜí Kiß╗âm tra Proxy</span>
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
                            <span>Ô£ô IP: {proxyCheckResult.ip}</span>
                            {proxyCheckResult.country && <span>({proxyCheckResult.country})</span>}
                            {proxyCheckResult.latencyMs !== undefined && (
                              <span className="font-mono text-emerald-400">┬À {proxyCheckResult.latencyMs}ms</span>
                            )}
                          </>
                        ) : (
                          <>
                            <span>Ô£ò {proxyCheckResult.error || "Proxy kh├┤ng kß║┐t nß╗æi ─æã░ß╗úc"}</span>
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
                    <span>─Éang kiß╗âm tra kß║┐t nß╗æi...</span>
                  </>
                ) : (
                  <span>­ƒöî Kiß╗âm tra kß║┐t nß╗æi</span>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isLoading || isTesting}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  Hß╗ºy
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
                      <span>{isEditMode ? "─Éang lã░u thay ─æß╗òi..." : "─Éang lã░u..."}</span>
                    </>
                  ) : (
                    <span>{isEditMode ? "Lã░u thay ─æß╗òi" : "Lã░u Store"}</span>
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
