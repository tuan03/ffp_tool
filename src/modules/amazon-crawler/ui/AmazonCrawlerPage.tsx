import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_AMAZON_CRAWLER_SETTINGS,
  type AmazonCrawlerCacheClearer,
  type AmazonCrawlerOutput,
  type AmazonCrawlerProgress,
  type AmazonCrawlerRunner,
  type AmazonCrawlerSettings,
} from "../types";

import { firstProductMediaUrl, resolveSelectedProduct } from "./product-selection";

interface AmazonCrawlerPageProps {
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer;
  runAmazonCrawler: AmazonCrawlerRunner;
}

type ResultTab = "overview" | "source" | "final" | "customize" | "json";

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
        onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))}
      />
    </label>
  );
}

function moneyLabel(raw: string | undefined, amount: number | undefined): string {
  if (raw) return raw;
  return amount === undefined ? "—" : `$${amount.toFixed(2)}`;
}

function optionLabel(options: Record<string, string>): string {
  const entries = Object.entries(options);
  return entries.length === 0 ? "Default" : entries.map(([name, value]) => `${name}: ${value}`).join(" · ");
}

export function AmazonCrawlerPage({ clearAmazonCrawlerCache, runAmazonCrawler }: AmazonCrawlerPageProps): React.JSX.Element {
  const [urlText, setUrlText] = useState("");
  const [settings, setSettings] = useState<AmazonCrawlerSettings>(DEFAULT_AMAZON_CRAWLER_SETTINGS);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<AmazonCrawlerProgress | null>(null);
  const [output, setOutput] = useState<AmazonCrawlerOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>("overview");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState<string | null>(null);
  const [isBatchJsonOpen, setIsBatchJsonOpen] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  const urls = useMemo(
    () => urlText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
    [urlText],
  );
  const selectedProduct = useMemo(
    () => resolveSelectedProduct(output?.products ?? [], selectedProductId),
    [output, selectedProductId],
  );

  useEffect(() => {
    const firstProduct = output?.products[0] ?? null;
    setSelectedProductId(firstProduct?.id ?? null);
    setSelectedMediaUrl(firstProductMediaUrl(firstProduct));
    setActiveTab("overview");
    setIsBatchJsonOpen(false);
  }, [output]);

  function handleSelectProduct(productId: string): void {
    const product = output?.products.find((candidate) => candidate.id === productId);
    setSelectedProductId(productId);
    setSelectedMediaUrl(firstProductMediaUrl(product ?? null));
    setActiveTab("overview");
  }

  function updateSetting<K extends keyof AmazonCrawlerSettings>(key: K, value: AmazonCrawlerSettings[K]): void {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function handleStart(): Promise<void> {
    if (urls.length === 0 || isRunning) return;
    const nextController = new AbortController();
    setController(nextController);
    setIsRunning(true);
    setError(null);
    setOutput(null);
    setProgress({ phase: "queued", completed: 0, total: urls.length, message: "Đang tạo job..." });
    try {
      const crawlerOutput = await runAmazonCrawler({
        input: { ...settings, urls },
        onProgress: setProgress,
        signal: nextController.signal,
      });
      setOutput(crawlerOutput);
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setError("Job đã được dừng an toàn.");
      } else {
        setError(caught instanceof Error ? caught.message : "Không thể chạy Amazon crawler.");
      }
    } finally {
      setController(null);
      setIsRunning(false);
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

  return (
    <div className="mt-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Amazon Crawler</h1>
        <p className="mt-2 text-sm text-slate-400">Cào Amazon family, tách product và xử lý Customize — không rewrite dữ liệu.</p>
      </div>

      <label className="grid gap-2 text-sm font-medium text-slate-200">
        Amazon URLs hoặc ASIN, mỗi dòng một giá trị
        <textarea
          className="min-h-40 rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-slate-100 outline-none focus:border-cyan-400"
          placeholder={"https://www.amazon.com/dp/B0...\nB0..."}
          value={urlText}
          onChange={(event) => setUrlText(event.target.value)}
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

      <button className="text-sm font-semibold text-cyan-300" type="button" onClick={() => setIsAdvancedOpen((open) => !open)}>
        {isAdvancedOpen ? "Ẩn" : "Hiện"} Advanced Settings
      </button>
      {isAdvancedOpen ? (
        <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4 sm:grid-cols-3">
          <NumberSetting label="Product threads" min={1} max={16} value={settings.productThreads} onChange={(value) => updateSetting("productThreads", value)} />
          <NumberSetting label="Variant threads" min={1} max={32} value={settings.variantThreads} onChange={(value) => updateSetting("variantThreads", value)} />
          <NumberSetting label="HTTP threads" min={1} max={64} value={settings.urllibThreads} onChange={(value) => updateSetting("urllibThreads", value)} />
          <NumberSetting label="Browser profiles" min={1} max={8} value={settings.browserProfiles} onChange={(value) => updateSetting("browserProfiles", value)} />
          <NumberSetting label="Tabs / profile" min={1} max={12} value={settings.browserTabs} onChange={(value) => updateSetting("browserTabs", value)} />
          <NumberSetting label="CAPTCHA timeout (s)" min={30} max={900} value={settings.captchaTimeoutSeconds} onChange={(value) => updateSetting("captchaTimeoutSeconds", value)} />
          <NumberSetting label="Matrix cap" min={1} max={5000} value={settings.maxMatrixVariants} onChange={(value) => updateSetting("maxMatrixVariants", value)} />
          <label className="grid gap-1 text-sm text-slate-300">Amazon ZIP<input className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" value={settings.amazonZip} onChange={(event) => updateSetting("amazonZip", event.target.value)} /></label>
          <label className="flex items-center gap-2 self-end p-2 text-sm"><input checked={settings.headless} type="checkbox" onChange={(event) => updateSetting("headless", event.target.checked)} /> Headless browser</label>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button className="rounded-lg bg-cyan-400 px-5 py-2 font-semibold text-slate-950 disabled:opacity-50" disabled={urls.length === 0 || isRunning} type="button" onClick={() => void handleStart()}>Start ({urls.length})</button>
        <button className="rounded-lg border border-rose-400 px-5 py-2 font-semibold text-rose-300 disabled:opacity-50" disabled={!isRunning} type="button" onClick={() => controller?.abort()}>Stop</button>
        {output === null ? null : <button className="rounded-lg border border-cyan-500 px-5 py-2 font-semibold text-cyan-300" type="button" onClick={handleDownload}>Tải JSON</button>}
        <button className="rounded-lg border border-amber-500 px-5 py-2 font-semibold text-amber-300 disabled:opacity-50" disabled={isRunning || isClearingCache} type="button" onClick={() => void handleClearCache()}>{isClearingCache ? "Đang xóa cache..." : "Xóa cache"}</button>
      </div>
      {cacheMessage === null ? null : <p className="text-sm text-amber-200">{cacheMessage}</p>}

      {progress === null ? null : (
        <div className={`rounded-xl border p-4 ${progress.phase === "captcha" ? "border-amber-400 bg-amber-950/30" : "border-slate-700 bg-slate-950/50"}`}>
          <div className="flex justify-between text-sm"><span>{progress.message}</span><span>{progress.completed}/{progress.total}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-cyan-400" style={{ width: `${progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : 0}%` }} /></div>
        </div>
      )}
      {error === null ? null : <p className="rounded-xl border border-rose-600 bg-rose-950/30 p-4 text-rose-200">{error}</p>}

      {output === null ? null : (
        <section className="space-y-4">
          <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-950/40 p-4 sm:grid-cols-4">
            <p><span className="block text-xs text-slate-400">Products</span>{output.statistics.products}</p>
            <p><span className="block text-xs text-slate-400">Source variants</span>{output.statistics.sourceVariants}</p>
            <p><span className="block text-xs text-slate-400">Final variants</span>{output.statistics.finalVariants}</p>
            <p><span className="block text-xs text-slate-400">Errors</span>{output.errors.length}</p>
          </div>
          {output.products.length === 0 ? (
            <p className="rounded-xl border border-slate-700 p-6 text-slate-400">Không có sản phẩm hợp lệ trong kết quả crawl.</p>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
              <aside className="max-h-[70vh] space-y-2 overflow-auto rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                <h2 className="px-2 pb-2 text-sm font-semibold text-slate-200">Tất cả sản phẩm</h2>
                {output.products.map((product) => {
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
                          {product.warnings.length ? <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-amber-200">{product.warnings.length} warning</span> : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </aside>

              {selectedProduct === null ? null : (
                <article className="min-w-0 space-y-5 rounded-xl border border-slate-700 bg-slate-950/30 p-4 sm:p-5">
                  <div className="grid gap-5 xl:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
                    <div>
                      {selectedMediaUrl ? (
                        <img alt={selectedProduct.title} className="aspect-square w-full rounded-xl bg-white object-contain" src={selectedMediaUrl} />
                      ) : (
                        <div className="flex aspect-square items-center justify-center rounded-xl bg-slate-900 text-sm text-slate-500">Không có ảnh</div>
                      )}
                      {selectedProduct.media.length > 1 ? (
                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                          {selectedProduct.media.map((media) => (
                            <button key={media.url} className={`shrink-0 rounded-md border p-1 ${selectedMediaUrl === media.url ? "border-cyan-400" : "border-slate-700"}`} type="button" onClick={() => setSelectedMediaUrl(media.url)}>
                              {media.kind === "image" ? <img alt="" className="h-14 w-14 bg-white object-contain" src={media.url} /> : <span className="flex h-14 w-14 items-center justify-center text-xs">Video</span>}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-cyan-300">{selectedProduct.parentAsin}</p>
                      <h2 className="mt-1 text-xl font-bold text-slate-100">{selectedProduct.title}</h2>
                      <p className="mt-2 text-sm text-slate-400">Amazon title: {selectedProduct.sourceTitle}</p>
                      <dl className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">Matrix</dt><dd>{selectedProduct.variantMatrix.discoveredCount}/{selectedProduct.variantMatrix.expectedCount} · {selectedProduct.variantMatrix.complete ? "Complete" : "Incomplete"}</dd></div>
                        <div><dt className="text-slate-500">Preset</dt><dd>{selectedProduct.preset ?? "—"}</dd></div>
                      </dl>
                      <a className="mt-4 inline-block text-sm font-semibold text-cyan-300 hover:text-cyan-200" href={selectedProduct.canonicalUrl} rel="noreferrer" target="_blank">Mở trên Amazon ↗</a>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-3">
                    {(["overview", "source", "final", "customize", "json"] as const).map((tab) => (
                      <button key={tab} className={`rounded-lg px-3 py-2 text-sm ${activeTab === tab ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`} type="button" onClick={() => setActiveTab(tab)}>
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
                    <div className="space-y-2">{selectedProduct.sourceVariants.map((variant) => <div key={variant.asin} className="rounded-lg border border-slate-800 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{variant.asin}</strong><span>{moneyLabel(variant.price?.raw, variant.price?.amount)}{variant.priceInference.isInferred ? " · inferred" : ""}</span></div><p className="mt-1 text-slate-300">{optionLabel(variant.options)}</p>{variant.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-300">⚠ {warning}</p>)}</div>)}</div>
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
          {output.errors.map((crawlError) => <p key={`${crawlError.source}-${crawlError.code}`} className="rounded-lg border border-rose-700 p-3 text-rose-200">{crawlError.source}: {crawlError.message}</p>)}
          <button className="text-sm font-semibold text-cyan-300" type="button" onClick={() => setIsBatchJsonOpen((open) => !open)}>{isBatchJsonOpen ? "Ẩn" : "Hiện"} Raw JSON toàn batch</button>
          {isBatchJsonOpen ? <pre className="max-h-[42rem] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-cyan-100">{JSON.stringify(output, null, 2)}</pre> : null}
        </section>
      )}
    </div>
  );
}
