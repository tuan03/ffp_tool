import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  DEFAULT_AMAZON_CRAWLER_SETTINGS,
  type AmazonCrawlerCacheClearer,
  type AmazonCrawlerClientSummary,
  type AmazonCrawlerClientsLoader,
  type AmazonCrawlerHandoverHandler,
  type AmazonCrawlerOutput,
  type AmazonCrawlerProgress,
  type AmazonCrawlerRunner,
  type AmazonCrawlerSettings,
  type AmazonCrawlerSyncRetrier,
} from "../types";

import {
  abortCrawlerJob,
  resetCrawlerOutput,
  setCrawlerActiveTab,
  setCrawlerSelectedMediaUrl,
  setCrawlerUrlText,
  startCrawlerJob,
  toggleCrawlerAdvancedOpen,
  toggleCrawlerBatchJsonOpen,
  updateCrawlerSession,
  updateCrawlerSetting,
  useAmazonCrawlerSession,
} from "./crawler-session";
import { firstProductMediaUrl, resolveSelectedProduct } from "./product-selection";
import { formatPipelineTimings } from "./pipeline-timings";

interface AmazonCrawlerPageProps {
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer;
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader;
  runAmazonCrawler: AmazonCrawlerRunner;
  onHandoverToSeo?: AmazonCrawlerHandoverHandler;
  retryAmazonCrawlerSyncs?: AmazonCrawlerSyncRetrier;
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="grid gap-1 text-sm text-slate-300">
      {label}
      <input
        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
        max={max}
        min={min}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function moneyLabel(raw: string | undefined, amount: number | undefined): string {
  if (raw) return raw;
  if (amount !== undefined) return `$${amount.toFixed(2)}`;
  return "—";
}

function optionLabel(options: Record<string, string>): string {
  const pairs = Object.entries(options);
  if (pairs.length === 0) return "Default";
  return pairs.map(([key, val]) => `${key}: ${val}`).join(" · ");
}

function progressPhaseLabel(phase: AmazonCrawlerProgress["phase"]): string {
  const labels: Record<AmazonCrawlerProgress["phase"], string> = {
    queued: "Chờ xử lý",
    product: "Sản phẩm / variant",
    variant_matrix: "Quét variant matrix",
    customization: "Amazon Customize",
    normalization: "Chuẩn hóa",
    seo: "Tạo nội dung SEO",
    shopify: "Đẩy Shopify",
    captcha: "Chờ CAPTCHA",
    export: "Xuất JSON",
  };
  return labels[phase];
}

export function AmazonCrawlerPage({
  clearAmazonCrawlerCache,
  loadAmazonCrawlerClients,
  onHandoverToSeo,
  retryAmazonCrawlerSyncs,
  runAmazonCrawler,
}: AmazonCrawlerPageProps): React.JSX.Element {
  const navigate = useNavigate();
  const session = useAmazonCrawlerSession();
  const {
    urlText,
    settings,
    isAdvancedOpen,
    isRunning,
    progress,
    output,
    error,
    activeTab,
    selectedProductId,
    selectedMediaUrl,
    isBatchJsonOpen,
  } = session;

  const [liveProducts, setLiveProducts] = useState<AmazonCrawlerOutput["products"]>([]);
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [isHandingOver, setIsHandingOver] = useState(false);
  const [handoverError, setHandoverError] = useState<string | null>(null);
  const [clients, setClients] = useState<AmazonCrawlerClientSummary[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isLoadingClients, setIsLoadingClients] = useState(true);

  const urls = useMemo(
    () => urlText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
    [urlText],
  );
  const resultProducts = output?.products ?? liveProducts;
  const selectedProduct = useMemo(
    () => resolveSelectedProduct(resultProducts, selectedProductId),
    [resultProducts, selectedProductId],
  );
  const activeMediaUrl = selectedMediaUrl ?? firstProductMediaUrl(selectedProduct);
  const selectedPipelineTimings = formatPipelineTimings(selectedProduct?.pipeline?.shopify.timings);

  useEffect(() => {
    if (selectedProductId && resultProducts.some((product) => product.id === selectedProductId)) return;
    const firstProduct = resultProducts[0] ?? null;
    if (firstProduct) {
      updateCrawlerSession({
        selectedProductId: firstProduct.id,
        selectedMediaUrl: firstProductMediaUrl(firstProduct),
      });
    }
  }, [resultProducts, selectedProductId]);

  useEffect(() => {
    let isMounted = true;
    async function refreshClients(): Promise<void> {
      try {
        const nextClients = await loadAmazonCrawlerClients();
        if (!isMounted) return;
        setClients(nextClients);
        setClientError(null);
      } catch (caught: unknown) {
        if (!isMounted) return;
        setClients([]);
        setClientError(caught instanceof Error ? caught.message : "Không tải được danh sách client.");
      } finally {
        if (isMounted) setIsLoadingClients(false);
      }
    }
    void refreshClients();
    const intervalId = window.setInterval(() => void refreshClients(), 5_000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [loadAmazonCrawlerClients]);

  function handleSelectProduct(productId: string): void {
    const product = resultProducts.find((candidate) => candidate.id === productId);
    updateCrawlerSession({
      selectedProductId: productId,
      selectedMediaUrl: firstProductMediaUrl(product ?? null),
      activeTab: "overview",
    });
  }

  function updateSetting<K extends keyof AmazonCrawlerSettings>(key: K, value: AmazonCrawlerSettings[K]): void {
    updateCrawlerSetting(key, value);
  }

  async function handleStart(): Promise<void> {
    setLiveProducts([]);
    setSyncMessage(null);
    await startCrawlerJob({
      runAmazonCrawler,
      urls,
      settings,
      onProducts: (products) => setLiveProducts([...products]),
    });
  }

  function handleStop(): void {
    abortCrawlerJob();
  }

  async function handleRetrySyncs(): Promise<void> {
    if (!output || isRetryingSync || !retryAmazonCrawlerSyncs) return;
    setIsRetryingSync(true);
    setSyncMessage(null);
    try {
      const retried = await retryAmazonCrawlerSyncs(output.jobId, {
        onProgress: (nextProgress) => {
          updateCrawlerSession({ progress: nextProgress });
        },
        onProducts: (products) => setLiveProducts([...products]),
      });
      if (retried.output) {
        updateCrawlerSession({ output: retried.output });
        setLiveProducts([...retried.output.products]);
      }
      setSyncMessage(`Đã đưa ${retried.retried} product lỗi trở lại hàng đợi Shopify.`);
    } catch (caught: unknown) {
      setSyncMessage(caught instanceof Error ? caught.message : "Không thể retry Shopify sync.");
    } finally {
      setIsRetryingSync(false);
    }
  }

  function handleDownload(): void {
    if (output === null) return;
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = output.exportFilename ?? `amazon-crawl-${output.jobId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleClearCache(): Promise<void> {
    if (isRunning || isClearingCache || !window.confirm("Xóa toàn bộ Amazon family cache? Các lần crawl sau sẽ tải lại dữ liệu từ Amazon.")) return;
    setIsClearingCache(true);
    setCacheMessage(null);
    try {
      const result = await clearAmazonCrawlerCache();
      const megabytes = result.removedBytes / (1024 * 1024);
      setCacheMessage(`Đã xóa ${result.removedFiles} cache file (${megabytes.toFixed(2)} MB).`);
    } catch (caught: unknown) {
      setCacheMessage(caught instanceof Error ? `Không thể xóa cache: ${caught.message}` : "Không thể xóa cache.");
    } finally {
      setIsClearingCache(false);
    }
  }

  async function handleHandover(): Promise<void> {
    if (!onHandoverToSeo || resultProducts.length === 0 || isHandingOver) return;
    setIsHandingOver(true);
    setHandoverError(null);
    try {
      await onHandoverToSeo(resultProducts);
      navigate("/seo-review");
    } catch (caught: unknown) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      setHandoverError(`Lỗi khi bàn giao sang SEO Review: ${msg}`);
    } finally {
      setIsHandingOver(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Amazon Crawler</h1>
        <p className="mt-2 text-sm text-slate-400">Cào Amazon family, tách product và xử lý Customize — không rewrite dữ liệu.</p>
      </div>

      <section className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-100">Crawler clients</h2>
            <p className="text-xs text-slate-400">Tự cập nhật mỗi 5 giây · job chỉ được tạo khi có ít nhất một client online.</p>
          </div>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">
            {clients.filter((client) => client.isConnected && ["online", "busy", "waiting_captcha"].includes(client.status)).length} online / {clients.length}
          </span>
        </div>
        {isLoadingClients ? <p className="mt-3 text-sm text-slate-400">Đang kiểm tra client...</p> : null}
        {clientError ? <p className="mt-3 text-sm text-rose-300">{clientError}</p> : null}
        {!isLoadingClients && !clientError && clients.length === 0 ? <p className="mt-3 text-sm text-amber-300">Chưa có client. Hãy mở FFP Amazon Crawler Agent.</p> : null}
        {clients.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((client) => (
              <article className="rounded-lg border border-slate-700 bg-slate-900/70 p-3" key={client.id}>
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-sm" title={client.displayName}>{client.displayName}</strong>
                  <span className={`text-xs font-semibold ${!client.isConnected || client.status === "offline" ? "text-rose-300" : client.status === "waiting_captcha" ? "text-amber-300" : "text-emerald-300"}`}>{client.isConnected ? client.status : "offline"}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{client.activeTasks} đang chạy · {client.availableSlots}/{client.maxConcurrentInputs} slot trống</p>
                {client.leasedTasks === client.activeTasks ? null : <p className="mt-1 text-xs text-amber-300">{client.leasedTasks} lease trên server đang chờ đồng bộ</p>}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <label className="grid gap-2 text-sm font-medium text-slate-200">
        Amazon URLs hoặc ASIN, mỗi dòng một giá trị
        <textarea
          className="min-h-40 rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-slate-100 outline-none focus:border-cyan-400"
          placeholder={"https://www.amazon.com/dp/B0...\nB0..."}
          value={urlText}
          onChange={(event) => setCrawlerUrlText(event.target.value)}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-slate-300">
          Profile
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            value={settings.profileSlug}
            onChange={(event) => updateSetting("profileSlug", event.target.value === "jeminise" ? "jeminise" : "default")}
          >
            <option value="default">Default</option>
            <option value="jeminise">Jeminise</option>
          </select>
        </label>
        <label className="flex items-center gap-3 self-end rounded-lg border border-slate-700 p-2 text-sm text-slate-200">
          <input
            checked={settings.applyJeminisePreset}
            disabled={settings.profileSlug !== "jeminise"}
            type="checkbox"
            onChange={(event) => updateSetting("applyJeminisePreset", event.target.checked)}
          />
          Thay variants bằng preset Jeminise 47 variants
        </label>
      </div>

      <button className="text-sm font-semibold text-cyan-300" type="button" onClick={toggleCrawlerAdvancedOpen}>
        {isAdvancedOpen ? "Ẩn" : "Hiện"} Advanced Settings
      </button>
      {isAdvancedOpen ? (
        <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4 sm:grid-cols-3">
          <NumberSetting label="Product threads" min={1} max={16} value={settings.productThreads} onChange={(value) => updateSetting("productThreads", value)} />
          <NumberSetting label="Variant threads" min={1} max={32} value={settings.variantThreads} onChange={(value) => updateSetting("variantThreads", value)} />
          <NumberSetting label="HTTP threads" min={1} max={64} value={settings.urllibThreads} onChange={(value) => updateSetting("urllibThreads", value)} />
          <NumberSetting label="Direct browser profiles" min={1} max={8} value={settings.browserProfiles} onChange={(value) => updateSetting("browserProfiles", value)} />
          <NumberSetting label="Tabs / profile" min={1} max={12} value={settings.browserTabs} onChange={(value) => updateSetting("browserTabs", value)} />
          <NumberSetting label="CAPTCHA timeout (s)" min={30} max={900} value={settings.captchaTimeoutSeconds} onChange={(value) => updateSetting("captchaTimeoutSeconds", value)} />
          <NumberSetting label="Matrix cap" min={1} max={5000} value={settings.maxMatrixVariants} onChange={(value) => updateSetting("maxMatrixVariants", value)} />
          <label className="grid gap-1 text-sm text-slate-300">Amazon ZIP<input className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" value={settings.amazonZip} onChange={(event) => updateSetting("amazonZip", event.target.value)} /></label>
          <label className="flex items-center gap-2 self-end p-2 text-sm"><input checked={settings.headless} type="checkbox" onChange={(event) => updateSetting("headless", event.target.checked)} /> Headless browser</label>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button className="rounded-lg bg-cyan-400 px-5 py-2 font-semibold text-slate-950 disabled:opacity-50" disabled={urls.length === 0 || isRunning} type="button" onClick={() => void handleStart()}>Start ({urls.length})</button>
        <button className="rounded-lg border border-rose-400 px-5 py-2 font-semibold text-rose-300 disabled:opacity-50" disabled={!isRunning} type="button" onClick={handleStop}>Stop</button>
        {output === null && resultProducts.length === 0 ? null : (
          <>
            {onHandoverToSeo ? (
              <button
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 font-semibold text-slate-950 shadow-sm transition-colors hover:bg-emerald-400 disabled:opacity-50"
                disabled={isRunning || isHandingOver || resultProducts.length === 0}
                type="button"
                onClick={() => void handleHandover()}
              >
                {isHandingOver ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-r-transparent" />
                    <span>Đang xử lý SEO ({resultProducts.length} SP)...</span>
                  </>
                ) : (
                  <>
                    <span>✨ Bàn giao sang SEO Review ({resultProducts.length})</span>
                  </>
                )}
              </button>
            ) : null}
            <button className="rounded-lg border border-cyan-500 px-5 py-2 font-semibold text-cyan-300" type="button" onClick={handleDownload}>Tải JSON</button>
            <button className="rounded-lg border border-slate-600 px-5 py-2 font-semibold text-slate-300 hover:border-rose-500 hover:text-rose-300 disabled:opacity-50" disabled={isRunning || isHandingOver} type="button" onClick={resetCrawlerOutput}>Xóa kết quả</button>
          </>
        )}
        <button className="rounded-lg border border-amber-500 px-5 py-2 font-semibold text-amber-300 disabled:opacity-50" disabled={isRunning || isClearingCache} type="button" onClick={() => void handleClearCache()}>{isClearingCache ? "Đang xóa cache..." : "Xóa cache"}</button>
      </div>
      {cacheMessage === null ? null : <p className="text-sm text-amber-200">{cacheMessage}</p>}
      {handoverError === null ? null : (
        <div className="rounded-xl border border-rose-600 bg-rose-950/40 p-4 text-sm text-rose-200">
          <p className="font-semibold text-rose-300">Không thể bàn giao sang SEO Review</p>
          <p className="mt-1">{handoverError}</p>
        </div>
      )}

      {progress === null ? null : (
        <div className={`space-y-4 rounded-xl border p-4 ${progress.phase === "captcha" ? "border-amber-400 bg-amber-950/30" : "border-slate-700 bg-slate-950/50"}`}>
          <div>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span>{progress.message}</span>
              <strong>{progress.completed}/{progress.total} products</strong>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-slate-800">
              <div className="h-full bg-cyan-400 transition-[width]" style={{ width: `${progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : 0}%` }} />
            </div>
            {progress.browserPool ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>Direct: {progress.browserPool.directActive} active · {progress.browserPool.directQueued} queued / {progress.browserPool.directProfiles * progress.browserPool.tabsPerProfile} slots</span>
                <span>Proxy: {progress.browserPool.proxyActive} active · {progress.browserPool.proxyQueued} queued / {progress.browserPool.proxyProfiles * progress.browserPool.tabsPerProfile} fallback slots</span>
              </div>
            ) : null}
          </div>
          {(progress.items ?? []).length === 0 ? null : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(progress.items ?? []).map((progressItem) => {
                const variantPercent = progressItem.variantTotal > 0
                  ? Math.min(100, (progressItem.variantCompleted / progressItem.variantTotal) * 100)
                  : 0;
                const statusStyle = progressItem.status === "completed"
                  ? "border-emerald-800 bg-emerald-950/20"
                  : progressItem.status === "failed"
                    ? "border-rose-800 bg-rose-950/20"
                    : progressItem.phase === "captcha"
                      ? "border-amber-600 bg-amber-950/30"
                      : "border-slate-700 bg-slate-900/60";
                return (
                  <article className={`min-w-0 rounded-lg border p-3 ${statusStyle}`} key={progressItem.source}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-cyan-200" title={progressItem.source}>{progressItem.asin}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{progressPhaseLabel(progressItem.phase)}</p>
                      </div>
                      <strong className="shrink-0 text-sm">
                        {progressItem.variantTotal > 0 ? `${progressItem.variantCompleted}/${progressItem.variantTotal}` : progressItem.status}
                      </strong>
                    </div>
                    <p className="mt-2 text-sm text-slate-200">{progressItem.message}</p>
                    {progressItem.currentOptions === undefined ? null : (
                      <p className="mt-1 text-xs text-slate-400">
                        {optionLabel(progressItem.currentOptions)}{progressItem.currentAsin ? ` · ${progressItem.currentAsin}` : ""}
                      </p>
                    )}
                    {progressItem.networkRoute === undefined ? null : (
                      <p className="mt-1 text-xs text-cyan-300">
                        Browser: {progressItem.networkRoute}{progressItem.browserProfile ? ` · ${progressItem.browserProfile}` : ""}
                      </p>
                    )}
                    {progressItem.variantTotal > 0 ? (
                      <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-800">
                        <div className="h-full bg-violet-400 transition-[width]" style={{ width: `${variantPercent}%` }} />
                      </div>
                    ) : null}
                    {(progressItem.activeVariants ?? []).length === 0 ? null : (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(progressItem.activeVariants ?? []).map((variant) => (
                          <span className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300" key={variant.asin}>
                            {optionLabel(variant.options)} · {variant.asin}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
      {error === null ? null : <p className="rounded-xl border border-rose-600 bg-rose-950/30 p-4 text-rose-200">{error}</p>}

      {output === null && resultProducts.length === 0 ? null : (
        <section className="space-y-4">
          {output ? (
            <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-950/40 p-4 sm:grid-cols-4">
              <p><span className="block text-xs text-slate-400">Products</span>{output.statistics.products}</p>
              <p><span className="block text-xs text-slate-400">Source variants</span>{output.statistics.sourceVariants}</p>
              <p><span className="block text-xs text-slate-400">Final variants</span>{output.statistics.finalVariants}</p>
              <p><span className="block text-xs text-slate-400">Errors</span>{output.errors.length}</p>
            </div>
          ) : (
            <p className="rounded-xl border border-cyan-800 bg-cyan-950/20 p-3 text-sm text-cyan-200">
              Product sẽ xuất hiện tại đây ngay khi từng nhóm split hoàn tất; chuẩn hóa và Shopify tiếp tục chạy ở server.
            </p>
          )}
          {resultProducts.length === 0 ? (
            <p className="rounded-xl border border-slate-700 p-6 text-slate-400">Không có sản phẩm hợp lệ trong kết quả crawl.</p>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
              <aside className="max-h-[70vh] space-y-2 overflow-auto rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between px-2 pb-2">
                  <h2 className="text-sm font-semibold text-slate-200">Tất cả sản phẩm</h2>
                  {onHandoverToSeo ? (
                    <button
                      className="rounded bg-emerald-500 hover:bg-emerald-400 px-2 py-1 text-xs font-semibold text-slate-950 disabled:opacity-50 transition-colors"
                      disabled={isRunning || isHandingOver}
                      type="button"
                      onClick={() => void handleHandover()}
                      title="Bàn giao toàn bộ sản phẩm sang SEO Review"
                    >
                      {isHandingOver ? "Đang xử lý..." : "Bàn giao SEO ➔"}
                    </button>
                  ) : null}
                </div>
                {resultProducts.map((product) => {
                  const isSelected = product.id === selectedProduct?.id;
                  return (
                    <button
                      key={product.id}
                      className={`grid w-full grid-cols-[3.5rem_1fr] gap-3 rounded-lg border p-2 text-left ${isSelected ? "border-cyan-400 bg-cyan-950/40" : "border-slate-800 bg-slate-900/60 hover:border-slate-600"}`}
                      type="button"
                      onClick={() => handleSelectProduct(product.id)}
                    >
                      {product.media[0]?.url ? <img alt="" className="h-14 w-14 rounded-md bg-white object-contain" src={product.media[0].url} /> : <span className="flex h-14 w-14 items-center justify-center rounded-md bg-slate-800 text-xs text-slate-500">No image</span>}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-100">{product.title}</span>
                        <span className="mt-1 block text-xs text-slate-400">{product.splitContext.attribute && product.splitContext.value ? `${product.splitContext.attribute}: ${product.splitContext.value}` : product.parentAsin}</span>
                        <span className="mt-1 block text-xs text-slate-300">{product.sourceVariants.length} source · {product.variants.length} final</span>
                        <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
                          {product.customization ? <span className="rounded bg-violet-900/60 px-1.5 py-0.5 text-violet-200">Customize</span> : null}
                          {product.preset ? <span className="rounded bg-cyan-900/60 px-1.5 py-0.5 text-cyan-200">{product.preset}</span> : null}
                          {product.pipeline ? <span className={`rounded px-1.5 py-0.5 ${product.pipeline.status === "completed" ? "bg-emerald-900/60 text-emerald-200" : product.pipeline.status === "failed" || product.pipeline.status === "reconciliation_required" ? "bg-rose-900/60 text-rose-200" : "bg-blue-900/60 text-blue-200"}`}>Pipeline: {product.pipeline.status}</span> : null}
                          {product.warnings.length ? <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-amber-200">{product.warnings.length} warning</span> : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </aside>

              {selectedProduct === null ? (
                <div className="rounded-xl border border-slate-700 p-8 text-center text-slate-400">Chọn một sản phẩm để xem chi tiết.</div>
              ) : (
                <article className="min-w-0 space-y-5 rounded-xl border border-slate-700 bg-slate-950/30 p-4 sm:p-5">
                  <div className="grid gap-5 xl:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
                    <div>
                      {activeMediaUrl ? (
                        <img alt={selectedProduct.title} className="aspect-square w-full rounded-xl bg-white object-contain" src={activeMediaUrl} />
                      ) : (
                        <div className="flex aspect-square items-center justify-center rounded-xl bg-slate-900 text-sm text-slate-500">Không có ảnh</div>
                      )}
                      {selectedProduct.media.length > 1 ? (
                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                          {selectedProduct.media.map((media) => (
                            <button key={media.url} className={`shrink-0 rounded-md border p-1 ${activeMediaUrl === media.url ? "border-cyan-400" : "border-slate-700"}`} type="button" onClick={() => setCrawlerSelectedMediaUrl(media.url)}>
                              {media.kind === "image" ? <img alt="" className="h-14 w-14 bg-white object-contain" src={media.url} /> : <span className="flex h-14 w-14 items-center justify-center text-xs">Video</span>}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <h3 className="text-xl font-bold text-slate-100">{selectedProduct.title}</h3>
                      <p className="mt-2 font-mono text-xs text-cyan-300">ASIN gốc: {selectedProduct.parentAsin}</p>
                      <dl className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">Matrix</dt><dd>{selectedProduct.variantMatrix.discoveredCount}/{selectedProduct.variantMatrix.expectedCount} · {selectedProduct.variantMatrix.complete ? "Complete" : "Incomplete"}</dd></div>
                        <div><dt className="text-slate-500">Preset</dt><dd>{selectedProduct.preset ?? "—"}</dd></div>
                        <div><dt className="text-slate-500">Pipeline</dt><dd>{selectedProduct.pipeline?.status ?? "Chưa nhận"}</dd></div>
                        <div><dt className="text-slate-500">SEO</dt><dd>{selectedProduct.pipeline?.seo.status ?? "pending"}{selectedProduct.pipeline?.seo.engine ? ` · ${selectedProduct.pipeline.seo.engine}` : ""}</dd></div>
                        <div><dt className="text-slate-500">Proxy Shopify</dt><dd>{selectedProduct.pipeline?.shopify.proxyProfile ?? "—"}</dd></div>
                      </dl>
                      <a className="mt-4 inline-block text-sm font-semibold text-cyan-300 hover:text-cyan-200" href={selectedProduct.canonicalUrl} rel="noreferrer" target="_blank">Mở trên Amazon ↗</a>
                      {selectedProduct.pipeline?.shopify.adminUrl ? <a className="ml-4 mt-4 inline-block text-sm font-semibold text-emerald-300 hover:text-emerald-200" href={selectedProduct.pipeline.shopify.adminUrl} rel="noreferrer" target="_blank">Mở trên Shopify ↗</a> : null}
                      {selectedPipelineTimings.length > 0 ? (
                        <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Thời gian xử lý</p>
                          <div className="mt-2 grid gap-1 text-xs text-slate-300 sm:grid-cols-2">
                            {selectedPipelineTimings.map((timing) => <span key={timing}>{timing}</span>)}
                          </div>
                        </div>
                      ) : null}
                      {selectedProduct.pipeline?.shopify.error ? <p className="mt-3 rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">Shopify: {selectedProduct.pipeline.shopify.error}</p> : null}
                      {selectedProduct.pipeline?.seo.fallbackStages?.length ? <p className="mt-3 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">SEO fallback: {selectedProduct.pipeline.seo.fallbackStages.join(", ")}</p> : null}
                      {selectedProduct.pipeline?.seo.warnings?.map((warning) => <p key={warning} className="mt-3 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">SEO: {warning}</p>)}
                      {selectedProduct.pipeline?.seo.error ? <p className="mt-3 rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">SEO: {selectedProduct.pipeline.seo.error}</p> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-3">
                    {(["overview", "source", "final", "customize", "json"] as const).map((tab) => (
                      <button key={tab} className={`rounded-lg px-3 py-2 text-sm ${activeTab === tab ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`} type="button" onClick={() => setCrawlerActiveTab(tab)}>
                        {{ overview: "Thông tin", source: "Source variants", final: "Final variants", customize: "Customize", json: "Product JSON" }[tab]}
                      </button>
                    ))}
                  </div>

                  {activeTab === "overview" ? (
                    <div className="space-y-4 text-sm">
                      {selectedProduct.description ? <p className="whitespace-pre-wrap text-slate-300">{selectedProduct.description}</p> : null}
                      {selectedProduct.bulletPoints.length ? <ul className="list-disc space-y-1 pl-5 text-slate-300">{selectedProduct.bulletPoints.map((point) => <li key={point}>{point}</li>)}</ul> : null}
                      <p className="text-slate-400">Categories: {selectedProduct.categories.join(" / ") || "—"}</p>
                      {Object.keys(selectedProduct.productDetails).length ? <dl className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-2">{Object.entries(selectedProduct.productDetails).map(([name, value]) => <div key={name}><dt className="text-slate-500">{name}</dt><dd>{value}</dd></div>)}</dl> : null}
                      {selectedProduct.warnings.map((warning) => <p key={warning} className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-amber-200">⚠ {warning}</p>)}
                    </div>
                  ) : null}
                  {activeTab === "source" ? (
                    <div className="space-y-2">{selectedProduct.sourceVariants.map((variant) => <div key={variant.asin} className="rounded-lg border border-slate-800 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{variant.asin}</strong><span>{moneyLabel(variant.price?.raw, variant.price?.amount)}{variant.priceInference.isInferred ? " · inferred" : ""}</span></div><p className="mt-1 text-slate-300">{optionLabel(variant.options)}</p>{variant.diagnostics ? <p className="mt-1 text-xs text-slate-500">Fetch: {variant.diagnostics.fetchMode} · {variant.diagnostics.attempts} attempts{variant.diagnostics.captchaEncountered ? " · CAPTCHA" : ""}</p> : null}{variant.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-300">⚠ {warning}</p>)}{variant.diagnostics?.fetchTrace ? <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-cyan-300">Fetch debug</summary><pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-950 p-3 text-[11px] text-slate-300">{JSON.stringify(variant.diagnostics.fetchTrace, null, 2)}</pre></details> : null}</div>)}</div>
                  ) : null}
                  {activeTab === "final" ? (
                    <div className="max-h-[42rem] space-y-2 overflow-auto pr-1">{selectedProduct.variants.map((variant) => <div key={variant.id} className="rounded-lg border border-slate-800 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong className="break-all">{variant.sku}</strong><span>{moneyLabel(variant.price?.raw, variant.price?.amount)}</span></div><p className="mt-1 text-slate-300">{optionLabel(variant.options)}</p><p className="mt-1 text-xs text-slate-500">Source: {variant.sourceAsin ?? "preset"} · Base: {variant.price && variant.surcharge ? `$${(variant.price.amount - variant.surcharge.amount).toFixed(2)}` : moneyLabel(variant.price?.raw, variant.price?.amount)} · Surcharge: {moneyLabel(variant.surcharge?.raw, variant.surcharge?.amount)}</p></div>)}</div>
                  ) : null}
                  {activeTab === "customize" ? (
                    selectedProduct.customization ? <div className="space-y-4"><div className="rounded-lg border border-violet-800 bg-violet-950/20 p-3 text-sm"><p className="font-semibold text-violet-200">Paid groups đã chuyển thành variants: {selectedProduct.customization.pricing.paidOptionGroups.length}</p>{selectedProduct.customization.pricing.paidOptionGroups.map((group) => <p key={group.id} className="mt-1 text-slate-300">{group.label}: {group.options.map((option) => `${option.label} (${moneyLabel(option.price.raw, option.price.amount)})`).join(" · ")}</p>)}</div><p className="text-sm text-slate-400">Controls còn lại: {selectedProduct.customization.optionGroups.length + selectedProduct.customization.textInputs.length + selectedProduct.customization.imageInputs.length + selectedProduct.customization.fontGroups.length + selectedProduct.customization.colorGroups.length}</p><pre className="max-h-[36rem] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">{JSON.stringify(selectedProduct.customization, null, 2)}</pre></div> : <p className="text-sm text-slate-400">Sản phẩm này không có Amazon Customize.</p>
                  ) : null}
                  {activeTab === "json" ? <pre className="max-h-[42rem] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-cyan-100">{JSON.stringify(selectedProduct, null, 2)}</pre> : null}
                </article>
              )}
            </div>
          )}
          {output?.errors.map((crawlError) => <p key={`${crawlError.source}-${crawlError.code}`} className="rounded-lg border border-rose-700 p-3 text-rose-200">{crawlError.source}: {crawlError.message}</p>)}
          {output?.status === "partial" ? <button className="rounded-lg border border-amber-600 px-3 py-2 text-sm font-semibold text-amber-200 disabled:opacity-50" disabled={isRetryingSync} type="button" onClick={() => void handleRetrySyncs()}>{isRetryingSync ? "Đang retry..." : "Retry Shopify lỗi"}</button> : null}
          {syncMessage ? <p className="text-sm text-amber-200">{syncMessage}</p> : null}
          {output ? <button className="text-sm font-semibold text-cyan-300" type="button" onClick={toggleCrawlerBatchJsonOpen}>{isBatchJsonOpen ? "Ẩn" : "Hiện"} Raw JSON toàn batch</button> : null}
          {isBatchJsonOpen && output ? <pre className="max-h-[42rem] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-cyan-100">{JSON.stringify(output, null, 2)}</pre> : null}
        </section>
      )}
    </div>
  );
}
