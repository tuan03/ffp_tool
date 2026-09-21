import { useMemo, useState } from "react";

import {
  DEFAULT_AMAZON_CRAWLER_SETTINGS,
  type AmazonCrawlerOutput,
  type AmazonCrawlerProgress,
  type AmazonCrawlerRunner,
  type AmazonCrawlerSettings,
} from "../types";

interface AmazonCrawlerPageProps {
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

export function AmazonCrawlerPage({ runAmazonCrawler }: AmazonCrawlerPageProps): React.JSX.Element {
  const [urlText, setUrlText] = useState("");
  const [settings, setSettings] = useState<AmazonCrawlerSettings>(DEFAULT_AMAZON_CRAWLER_SETTINGS);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<AmazonCrawlerProgress | null>(null);
  const [output, setOutput] = useState<AmazonCrawlerOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>("overview");

  const urls = useMemo(
    () => urlText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
    [urlText],
  );

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
      </div>

      {progress === null ? null : (
        <div className={`rounded-xl border p-4 ${progress.phase === "captcha" ? "border-amber-400 bg-amber-950/30" : "border-slate-700 bg-slate-950/50"}`}>
          <div className="flex justify-between text-sm"><span>{progress.message}</span><span>{progress.completed}/{progress.total}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-cyan-400" style={{ width: `${progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : 0}%` }} /></div>
        </div>
      )}
      {error === null ? null : <p className="rounded-xl border border-rose-600 bg-rose-950/30 p-4 text-rose-200">{error}</p>}

      {output === null ? null : (
        <section className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["overview", "source", "final", "customize", "json"] as const).map((tab) => <button key={tab} className={`rounded-lg px-3 py-2 text-sm ${activeTab === tab ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`} type="button" onClick={() => setActiveTab(tab)}>{tab}</button>)}
          </div>
          {activeTab === "overview" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4"><p>Products: {output.statistics.products}</p><p>Source variants: {output.statistics.sourceVariants}</p><p>Final variants: {output.statistics.finalVariants}</p><p>Errors: {output.errors.length}</p></div>
              {output.products.map((product) => (
                <article key={product.id} className="rounded-xl border border-slate-700 p-4 text-sm">
                  <h2 className="font-semibold text-slate-100">{product.title}</h2>
                  <p className="mt-1 text-slate-400">Source: {product.sourceTitle}</p>
                  <p className="mt-1 text-slate-300">Split: {product.splitContext.attribute ?? "none"} / {product.splitContext.value ?? "none"} · Matrix: {product.variantMatrix.discoveredCount}/{product.variantMatrix.expectedCount} {product.variantMatrix.complete ? "complete" : "incomplete"} · Preset: {product.preset ?? "none"}</p>
                  {product.warnings.map((warning) => <p key={warning} className="mt-1 text-amber-300">⚠ {warning}</p>)}
                </article>
              ))}
              {output.errors.map((crawlError) => <p key={`${crawlError.source}-${crawlError.code}`} className="rounded-lg border border-rose-700 p-3 text-rose-200">{crawlError.source}: {crawlError.message}</p>)}
            </div>
          ) : null}
          {activeTab === "source" ? output.products.map((product) => <article key={product.id} className="rounded-xl border border-slate-700 p-4"><h2 className="font-semibold">{product.title}</h2>{product.sourceVariants.map((variant) => <p key={variant.asin} className="mt-2 text-sm text-slate-300">{variant.asin} · {Object.entries(variant.options).map(([key, value]) => `${key}: ${value}`).join(" / ")} · {moneyLabel(variant.price?.raw, variant.price?.amount)} {variant.priceInference.isInferred ? "(inferred)" : ""}</p>)}</article>) : null}
          {activeTab === "final" ? output.products.map((product) => <article key={product.id} className="rounded-xl border border-slate-700 p-4"><h2 className="font-semibold">{product.title}</h2><p className="text-xs text-slate-400">Split: {product.splitContext.attribute ?? "none"} / {product.splitContext.value ?? "none"} · Preset: {product.preset ?? "none"}</p>{product.variants.map((variant) => <p key={variant.id} className="mt-2 text-sm text-slate-300">{variant.sku} · {Object.values(variant.options).join(" / ")} · {moneyLabel(variant.price?.raw, variant.price?.amount)}{variant.surcharge?.amount ? ` (+${variant.surcharge.amount.toFixed(2)})` : ""}</p>)}</article>) : null}
          {activeTab === "customize" ? output.products.map((product) => <article key={product.id} className="rounded-xl border border-slate-700 p-4"><h2 className="font-semibold">{product.title}</h2><pre className="mt-3 max-h-96 overflow-auto text-xs text-slate-300">{JSON.stringify(product.customization, null, 2)}</pre></article>) : null}
          {activeTab === "json" ? <pre className="max-h-[40rem] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-cyan-100">{JSON.stringify(output, null, 2)}</pre> : null}
        </section>
      )}
    </div>
  );
}
