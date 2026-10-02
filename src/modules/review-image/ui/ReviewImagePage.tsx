import { useEffect, useMemo, useRef, useState } from "react";

import { encodeImageFile } from "../service";
import { buildTemplateSequence, getReviewImageStorePreset } from "../store-presets";
import type { ReviewImageClient, ReviewImageJob, ReviewImageScope, ReviewImageShopifyFile, ReviewImageTemplate } from "../types";

type BatchStatus = "ready" | "queued" | "running" | "completed" | "failed" | "cancelled" | "uploading" | "uploaded";

interface ReviewProductImage {
  readonly id: string;
  readonly name: string;
  readonly dataUrl: string;
  readonly status: BatchStatus;
  readonly job?: ReviewImageJob;
  readonly resultDataUrl?: string;
  readonly shopifyFile?: ReviewImageShopifyFile;
  readonly error?: string;
  readonly conversationSessionId?: string;
}

export interface ReviewImagePageProps {
  readonly client: ReviewImageClient;
  readonly storeId?: string;
  readonly stores?: readonly string[];
  readonly onStoreIdChange?: (storeId: string) => void;
  readonly onShopifyFile?: (storeId: string, file: ReviewImageShopifyFile) => void;
  readonly onBusyChange?: (isBusy: boolean) => void;
  readonly embedded?: boolean;
  readonly showStoreSelector?: boolean;
}

const POLL_INTERVAL_MS = 1_500;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Không đọc được ảnh kết quả."));
    reader.readAsDataURL(blob);
  });
}

function makeItemId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

const STORE_LABELS: Readonly<Record<string, string>> = {
  preaureum: "Preaureum · Túi và ví",
  capozen: "Capozen · Thảm",
  jeminise: "Jeminise · Chăn ga",
};

function getStoreLabel(storeId: string): string {
  return STORE_LABELS[storeId] ?? storeId;
}

export function ReviewImagePage({
  client,
  storeId: controlledStoreId,
  stores = ["preaureum", "capozen", "jeminise"],
  onStoreIdChange,
  onShopifyFile,
  onBusyChange,
  embedded = false,
  showStoreSelector = true,
}: ReviewImagePageProps): React.JSX.Element {
  const [internalStoreId, setInternalStoreId] = useState(stores[0] ?? "preaureum");
  const storeId = controlledStoreId ?? internalStoreId;
  const preset = useMemo(() => getReviewImageStorePreset(storeId), [storeId]);
  const [scope, setScope] = useState<ReviewImageScope>(preset.scope);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const prompt = promptDrafts[storeId] ?? preset.prompt;
  const [products, setProducts] = useState<readonly ReviewProductImage[]>([]);
  const [templates, setTemplates] = useState<readonly ReviewImageTemplate[] | null>(null);
  const [previewTemplateName, setPreviewTemplateName] = useState("");
  const [previewTemplateUrl, setPreviewTemplateUrl] = useState("");
  const [selectedTemplateNames, setSelectedTemplateNames] = useState<Set<string>>(new Set());
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateNotice, setTemplateNotice] = useState("");
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isStopRequested, setIsStopRequested] = useState(false);
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [error, setError] = useState("");
  const [extensionConnected, setExtensionConnected] = useState<boolean | undefined>(undefined);
  const [gatewayToken, setGatewayToken] = useState("");
  const stopRequestedRef = useRef(false);
  const activeJobRef = useRef<{ readonly jobId: string; readonly itemId: string } | null>(null);
  const isBusy = isBatchRunning || isBulkUploading || templateBusy;

  useEffect(() => { onBusyChange?.(isBusy); }, [isBusy, onBusyChange]);

  useEffect(() => {
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        const health = await client.health();
        if (active) setExtensionConnected(health.extensionConnected);
      } catch {
        if (active) setExtensionConnected(false);
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [client]);

  const updateProduct = (id: string, patch: Partial<ReviewProductImage>): void => {
    setProducts((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  useEffect(() => {
    let active = true;
    setTemplates(null);
    setSelectedTemplateNames(new Set());
    setPreviewTemplateName("");
    setTemplateNotice("");
    setProducts([]);
    setScope(preset.scope);
    void client.listTemplates(storeId).then((items) => {
      if (!active) return;
      setTemplates(items);
      setPreviewTemplateName(items[0]?.name ?? "");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không tải được template.");
    });
    return () => { active = false; };
  }, [client, preset.scope, storeId]);

  useEffect(() => {
    if (!previewTemplateName) {
      setPreviewTemplateUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    void client.template(storeId, previewTemplateName).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setPreviewTemplateUrl(objectUrl);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không tải được ảnh template.");
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, previewTemplateName, storeId]);

  function handleStoreChange(nextStoreId: string): void {
    if (isBusy) return;
    if (controlledStoreId === undefined) setInternalStoreId(nextStoreId);
    onStoreIdChange?.(nextStoreId);
  }

  async function addProductFiles(files: readonly File[]): Promise<void> {
    setError("");
    const additions: ReviewProductImage[] = [];
    for (const file of files) {
      try {
        additions.push({ id: makeItemId(), name: file.name || "Ảnh đã dán", dataUrl: await encodeImageFile(file), status: "ready" });
      } catch (cause) {
        setError(cause instanceof Error ? `${file.name}: ${cause.message}` : "Ảnh sản phẩm không hợp lệ.");
      }
    }
    if (additions.length) setProducts((current) => [...current, ...additions]);
  }

  function clipboardFiles(event: React.ClipboardEvent<HTMLDivElement>): readonly File[] {
    return Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .flatMap((item) => { const file = item.getAsFile(); return file ? [file] : []; });
  }

  function handleProductPaste(event: React.ClipboardEvent<HTMLDivElement>): void {
    const files = clipboardFiles(event);
    if (!files.length) {
      setError("Clipboard chưa có ảnh PNG, JPEG hoặc WebP.");
      return;
    }
    event.preventDefault();
    void addProductFiles(files);
  }

  async function handleTemplateUpload(files: readonly File[]): Promise<void> {
    if (!files.length) return;
    setTemplateBusy(true);
    setError("");
    let uploaded = 0;
    const failures: string[] = [];
    const created: ReviewImageTemplate[] = [];
    try {
      for (const file of files) {
        try {
          created.push(await client.uploadTemplate({ storeId, fileName: file.name, imageDataUrl: await encodeImageFile(file) }));
          uploaded += 1;
        } catch (cause) {
          failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "upload thất bại"}`);
        }
      }
      setTemplates((current) => [...(current ?? []), ...created].sort((left, right) => left.name.localeCompare(right.name)));
      if (created.length) setPreviewTemplateName(created.at(-1)?.name ?? "");
      setTemplateNotice(failures.length ? `Đã tải ${uploaded}/${files.length}. ${failures.join("; ")}` : `Đã tải ${uploaded} template.`);
    } finally {
      setTemplateBusy(false);
    }
  }

  function handleTemplatePaste(event: React.ClipboardEvent<HTMLDivElement>): void {
    const files = clipboardFiles(event);
    if (!files.length) return;
    event.preventDefault();
    void handleTemplateUpload(files);
  }

  async function handleDeleteTemplates(): Promise<void> {
    const names = [...selectedTemplateNames];
    if (!names.length || !window.confirm(`Xóa ${names.length} template đã chọn?`)) return;
    setTemplateBusy(true);
    setError("");
    try {
      const outcome = await client.deleteTemplates(storeId, names);
      const deleted = new Set(outcome.deleted);
      const remaining = (templates ?? []).filter((template) => !deleted.has(template.name));
      setTemplates(remaining);
      setSelectedTemplateNames(new Set(outcome.failures.map((failure) => failure.name)));
      if (deleted.has(previewTemplateName)) setPreviewTemplateName(remaining[0]?.name ?? "");
      setTemplateNotice(`Đã xóa ${outcome.deleted.length}/${names.length} template.${outcome.failures.length ? ` ${outcome.failures.map((failure) => `${failure.name}: ${failure.message}`).join("; ")}` : ""}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xóa được template.");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function waitForJob(jobId: string, itemId: string): Promise<ReviewImageJob> {
    while (true) {
      await delay(POLL_INTERVAL_MS);
      const job = await client.job(jobId);
      updateProduct(itemId, { job, status: job.status });
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return job;
    }
  }

  async function runProduct(item: ReviewProductImage, templateName: string, conversationSessionId: string): Promise<void> {
    updateProduct(item.id, { status: "queued", error: undefined, resultDataUrl: undefined, shopifyFile: undefined, conversationSessionId });
    try {
      const created = await client.create({ storeId, productDataUrl: item.dataUrl, prompt: prompt.trim(), scope, templateName, conversationSessionId });
      activeJobRef.current = { jobId: created.job_id, itemId: item.id };
      updateProduct(item.id, { job: created, status: created.status });
      if (stopRequestedRef.current) {
        const cancelled = await client.cancel(created.job_id);
        updateProduct(item.id, { job: cancelled, status: cancelled.status });
        return;
      }
      const completed = await waitForJob(created.job_id, item.id);
      if (stopRequestedRef.current && completed.status !== "cancelled") {
        const cancelled = await client.cancel(created.job_id);
        updateProduct(item.id, { job: cancelled, status: cancelled.status, resultDataUrl: undefined, error: undefined });
        return;
      }
      if (completed.status === "cancelled") {
        updateProduct(item.id, { status: "cancelled", resultDataUrl: undefined, error: undefined });
        return;
      }
      if (completed.status === "failed") {
        updateProduct(item.id, { status: "failed", error: completed.error || "Tạo ảnh thất bại." });
        return;
      }
      updateProduct(item.id, { status: "completed", resultDataUrl: await blobToDataUrl(await client.image(completed.job_id)) });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Tạo ảnh thất bại.";
      updateProduct(item.id, { status: "failed", error: stopRequestedRef.current ? `Không thể xác nhận đã dừng ảnh: ${message}` : message });
    } finally {
      if (activeJobRef.current?.itemId === item.id) activeJobRef.current = null;
    }
  }

  async function handleStopBatch(): Promise<void> {
    if (!isBatchRunning || isStopRequested) return;
    stopRequestedRef.current = true;
    setIsStopRequested(true);
    const activeJob = activeJobRef.current;
    if (!activeJob) return;
    try {
      const cancelled = await client.cancel(activeJob.jobId);
      updateProduct(activeJob.itemId, { job: cancelled, status: cancelled.status, resultDataUrl: undefined, error: undefined });
    } catch (cause) {
      setError(cause instanceof Error ? `Không thể dừng ảnh đang chạy: ${cause.message}` : "Không thể dừng ảnh đang chạy.");
    }
  }

  async function handleGenerateBatch(): Promise<void> {
    const pending = products.filter((item) => item.status === "ready" || item.status === "failed" || item.status === "cancelled");
    const templateNames = (templates ?? []).map((template) => template.name);
    if (!pending.length || !prompt.trim() || !templateNames.length) {
      setError("Hãy thêm ảnh sản phẩm, template và prompt trước khi tạo.");
      return;
    }
    setError("");
    stopRequestedRef.current = false;
    setIsStopRequested(false);
    setIsBatchRunning(true);
    try {
      const sequence = buildTemplateSequence(templateNames, pending.length);
      const conversationSessionId = `${storeId}-${makeItemId()}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
      for (const [index, item] of pending.entries()) {
        if (stopRequestedRef.current) break;
        const templateName = sequence[index] ?? templateNames[0];
        if (!templateName) break;
        await runProduct(item, templateName, conversationSessionId);
      }
    } finally {
      activeJobRef.current = null;
      stopRequestedRef.current = false;
      setIsStopRequested(false);
      setIsBatchRunning(false);
    }
  }

  async function handleRetry(item: ReviewProductImage, useDifferentTemplate: boolean): Promise<void> {
    const names = (templates ?? []).map((template) => template.name);
    if (!item.job || !names.length) return;
    const alternatives = names.filter((name) => name !== item.job?.template_name);
    const alternative = alternatives[Math.floor(Math.random() * alternatives.length)];
    const templateName = useDifferentTemplate && alternative ? alternative : item.job.template_name;
    const conversationSessionId = item.conversationSessionId ?? `${storeId}-${makeItemId()}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
    stopRequestedRef.current = false;
    setIsStopRequested(false);
    setIsBatchRunning(true);
    try {
      await runProduct(item, templateName, conversationSessionId);
    } finally {
      activeJobRef.current = null;
      stopRequestedRef.current = false;
      setIsStopRequested(false);
      setIsBatchRunning(false);
    }
  }

  async function approveAndUpload(item: ReviewProductImage): Promise<void> {
    if (!item.job || item.job.status !== "completed") return;
    updateProduct(item.id, { status: "uploading", error: undefined });
    try {
      const approved = item.job.approved ? item.job : await client.approve(item.job.job_id);
      const shopifyFile = await client.uploadToShopify(approved.job_id, storeId);
      updateProduct(item.id, { job: approved, shopifyFile, status: "uploaded" });
      onShopifyFile?.(storeId, shopifyFile);
    } catch (cause) {
      updateProduct(item.id, { status: "completed", error: cause instanceof Error ? cause.message : "Không upload được ảnh lên Shopify." });
    }
  }

  async function handleBulkApproveAndUpload(): Promise<void> {
    const completed = products.filter((item) => item.status === "completed" && !item.shopifyFile);
    setIsBulkUploading(true);
    try {
      for (const item of completed) await approveAndUpload(item);
    } finally {
      setIsBulkUploading(false);
    }
  }

  async function handleDownload(item: ReviewProductImage): Promise<void> {
    if (!item.job?.approved) return;
    try {
      const blob = await client.download(item.job.job_id);
      const extension = blob.type === "image/jpeg" ? ".jpg" : blob.type === "image/webp" ? ".webp" : ".png";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `review-${item.job.job_id}${extension}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      updateProduct(item.id, { error: cause instanceof Error ? cause.message : "Không tải được ảnh." });
    }
  }

  async function applyGatewayToken(): Promise<void> {
    client.setGatewayToken(gatewayToken);
    setError("");
    try {
      await client.health();
      setTemplates(await client.listTemplates(storeId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gateway token không hợp lệ.");
    }
  }

  const completedCount = products.filter((item) => item.status === "completed" && !item.shopifyFile).length;
  const fieldClass = "mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-500";
  const buttonClass = "rounded-xl px-4 py-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

  return <section className="space-y-6 text-slate-100">
    {extensionConnected === false ? <p role="status" className="rounded border border-amber-700 bg-amber-950/30 p-3 text-amber-200">Chưa kết nối được extension tạo ảnh. Hãy mở tab ChatGPT, ghim tab trong extension và kết nối đến FFP; nếu vẫn lỗi, kiểm tra Gateway token.</p> : null}
    {!embedded ? <header><h1 className="text-3xl font-bold">Tạo ảnh review</h1><p className="mt-1 text-sm text-slate-400">Tạo ảnh theo template, duyệt và đưa vào Shopify Files.</p></header> : null}
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div><h2 className="text-lg font-semibold">Chuẩn bị lô ảnh review</h2><p className="mt-1 text-sm text-slate-400">Làm lần lượt theo các bước bên dưới. Mỗi ảnh sản phẩm sẽ nhận một ảnh nền từ kho template của store.</p></div>
        {showStoreSelector ? <section className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4">
          <label className="block text-sm font-semibold text-cyan-100">1. Chọn store và loại sản phẩm<select className={`${fieldClass} border-cyan-700/70 bg-slate-950`} disabled={isBusy} value={storeId} onChange={(event) => handleStoreChange(event.target.value)}>{stores.map((store) => <option key={store} value={store}>{getStoreLabel(store)}</option>)}</select></label>
          <p className="mt-2 text-xs leading-5 text-cyan-200/80">Store quyết định kho ảnh nền và prompt phù hợp với sản phẩm. Hiện tại: <strong>{preset.productLabel}</strong>.</p>
        </section> : null}
        <details className="rounded-xl border border-slate-700/80 bg-slate-950/40 p-3 text-sm"><summary className="cursor-pointer text-slate-300">Cấu hình nâng cao · Gateway token</summary><div className="mt-2 flex gap-2"><input className={fieldClass} type="password" value={gatewayToken} onChange={(event) => setGatewayToken(event.target.value)} /><button type="button" className={`${buttonClass} bg-slate-700`} onClick={() => void applyGatewayToken()}>Kết nối</button></div></details>
        <details className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-4 text-sm" open>
          <summary className="cursor-pointer font-semibold text-violet-100">2. Chuẩn bị kho ảnh nền</summary>
          <div className="mt-3 space-y-3">
            <p className="rounded-lg bg-violet-950/50 px-3 py-2 text-xs leading-5 text-violet-200">Tất cả template trong kho sẽ được xoay vòng ngẫu nhiên khi tạo lô ảnh. Bạn chỉ cần thêm ảnh khi muốn bổ sung nền mới.</p>
            <label className="block font-medium text-violet-100">Thêm ảnh nền mới vào kho<input className={`${fieldClass} border-violet-700/70`} type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={templateBusy} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void handleTemplateUpload(files); }} /></label>
            <div className="rounded-xl border border-dashed border-violet-500/60 bg-slate-950/40 p-3 text-center text-violet-200 outline-none transition focus:border-violet-300 focus:bg-violet-500/10" tabIndex={0} role="group" aria-label="Vùng dán ảnh template" onPaste={handleTemplatePaste}>Hoặc nhấn vào đây rồi Ctrl+V để dán một hay nhiều ảnh nền</div>
            {templateNotice ? <p role="status" className="text-sm text-cyan-300">{templateNotice}</p> : null}
            <p className="text-xs text-amber-200">Checkbox chỉ dùng để đánh dấu template cần xóa. Nhấn tên template để xem ảnh lớn.</p>
            {templates === null ? <p className="text-slate-400">Đang tải template…</p> : templates.length === 0 ? <p className="text-slate-400">Store chưa có template.</p> : <div className="grid gap-3 sm:grid-cols-2">
              <div><div className="mb-2 flex gap-3 text-xs"><button type="button" className="font-medium text-violet-300" onClick={() => setSelectedTemplateNames(new Set(templates.map((template) => template.name)))}>Đánh dấu tất cả</button><button type="button" className="text-slate-400" onClick={() => setSelectedTemplateNames(new Set())}>Bỏ đánh dấu</button></div><ul className="max-h-64 space-y-1 overflow-auto">{templates.map((template) => <li key={template.name} className={`flex items-center gap-2 rounded border p-2 transition ${previewTemplateName === template.name ? "border-violet-500 bg-violet-500/10" : "border-slate-800 bg-slate-950/40"}`}><input type="checkbox" aria-label={`Đánh dấu xóa ${template.name}`} checked={selectedTemplateNames.has(template.name)} onChange={() => setSelectedTemplateNames((current) => { const next = new Set(current); if (next.has(template.name)) next.delete(template.name); else next.add(template.name); return next; })} /><button type="button" className="min-w-0 flex-1 truncate text-left text-xs" onClick={() => setPreviewTemplateName(template.name)}>{template.name}</button></li>)}</ul></div>
              <figure className="flex min-h-40 items-center justify-center rounded-lg border border-violet-700/60 bg-slate-950 p-2">{previewTemplateUrl ? <img className="max-h-56 object-contain" src={previewTemplateUrl} alt={`Template ${previewTemplateName}`} /> : <figcaption className="text-slate-400">Nhấn tên template để xem ảnh.</figcaption>}</figure>
            </div>}
            <button type="button" className={`${buttonClass} border border-rose-700 bg-rose-950/30 text-rose-200`} disabled={!selectedTemplateNames.size || templateBusy} onClick={() => void handleDeleteTemplates()}>{templateBusy ? "Đang xử lý…" : `Xóa template đã đánh dấu (${selectedTemplateNames.size})`}</button>
          </div>
        </details>
        <section className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <div><h3 className="font-semibold text-emerald-100">3. Thêm ảnh sản phẩm cần tạo review</h3><p className="mt-1 text-xs leading-5 text-emerald-200/80">Mỗi ảnh đầu vào sẽ tạo một ảnh review riêng. Bạn có thể chọn nhiều file cùng lúc hoặc dán ảnh nhiều lần.</p></div>
          <label className="block font-medium text-emerald-100">Chọn một hoặc nhiều ảnh sản phẩm<input className={`${fieldClass} border-emerald-700/70`} type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={isBatchRunning} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addProductFiles(files); }} /></label>
          <div className="rounded-xl border border-dashed border-emerald-500/60 bg-slate-950/40 p-4 text-center text-emerald-200 outline-none transition focus:border-emerald-300 focus:bg-emerald-500/10" tabIndex={0} role="group" aria-label="Vùng dán ảnh sản phẩm" onPaste={handleProductPaste}>Ctrl+V để dán ảnh sản phẩm; có thể dán thêm nhiều lần</div>
          {products.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{products.map((item) => <figure key={item.id} className="relative rounded border border-emerald-800/70 bg-slate-950 p-2"><img className="h-28 w-full object-contain" src={item.dataUrl} alt={item.name} /><figcaption className="truncate text-xs text-slate-400">{item.name}</figcaption>{item.status === "ready" && !isBatchRunning ? <button type="button" className="absolute right-1 top-1 rounded bg-rose-950 px-2 text-rose-200" aria-label={`Xóa ${item.name}`} onClick={() => setProducts((current) => current.filter((candidate) => candidate.id !== item.id))}>×</button> : null}</figure>)}</div> : null}
        </section>
        {preset.supportsBagSet ? <label className="block text-sm">Sản phẩm cần xuất hiện<select className={fieldClass} value={scope} onChange={(event) => setScope(event.target.value as ReviewImageScope)}><option value="main">Chỉ túi chính</option><option value="set">Cả túi và ví</option></select></label> : null}
        <label className="block text-sm">Prompt gửi ChatGPT<textarea className={`${fieldClass} min-h-64`} maxLength={10_000} value={prompt} onChange={(event) => setPromptDrafts((current) => ({ ...current, [storeId]: event.target.value }))} /></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${buttonClass} bg-cyan-500 text-slate-950`} disabled={isBusy || !products.some((item) => item.status === "ready" || item.status === "failed" || item.status === "cancelled") || !templates?.length} onClick={() => void handleGenerateBatch()}>{isBatchRunning ? "Đang tạo lần lượt…" : `Tạo ${products.filter((item) => item.status === "ready" || item.status === "failed" || item.status === "cancelled").length} ảnh review`}</button>
          <button type="button" className={`${buttonClass} border border-rose-500 bg-rose-950/60 text-rose-100`} disabled={!isBatchRunning || isStopRequested} onClick={() => void handleStopBatch()}>{isStopRequested ? "Đang dừng…" : "Dừng tạo ảnh"}</button>
        </div>
        {isStopRequested ? <p role="status" className="text-sm text-amber-200">Đang hủy ảnh hiện tại và bỏ qua các ảnh còn lại trong lô…</p> : null}
        {error ? <p role="alert" className="rounded border border-rose-700 bg-rose-950/40 p-3 text-rose-200">{error}</p> : null}
      </section>
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Kết quả ({products.length})</h2><p className="text-sm text-slate-400">Duyệt ảnh đạt yêu cầu trước khi đưa lên Shopify Files.</p></div><button type="button" className={`${buttonClass} bg-emerald-700`} disabled={!completedCount || isBusy} onClick={() => void handleBulkApproveAndUpload()}>{isBulkUploading ? "Đang upload…" : `Duyệt & upload tất cả (${completedCount})`}</button></div>
        {!products.length ? <div className="flex min-h-64 items-center justify-center rounded border border-dashed border-slate-700 text-slate-500">Chưa có ảnh trong lô.</div> : products.map((item, index) => <article key={item.id} className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
          <div className="flex justify-between gap-2 text-sm"><strong>Ảnh {index + 1}: {item.name}</strong><span className="text-cyan-300">{item.status}</span></div>
          <div className="grid gap-3 sm:grid-cols-2"><img className="max-h-64 w-full object-contain" src={item.dataUrl} alt={`Sản phẩm ${item.name}`} />{item.resultDataUrl ? <img className="max-h-64 w-full object-contain" src={item.resultDataUrl} alt={`Kết quả ${item.name}`} /> : <div className="flex min-h-40 items-center justify-center rounded border border-dashed border-slate-700 text-sm text-slate-500">{item.status === "queued" || item.status === "running" ? "Đang tạo ảnh…" : "Chưa có kết quả"}</div>}</div>
          {item.job ? <p className="text-xs text-slate-400">Template: {item.job.template_name}</p> : null}
          {item.error ? <p className="text-sm text-rose-300">{item.error}</p> : null}
          {item.shopifyFile ? <p className="break-all text-sm text-emerald-300">Shopify: <a className="underline" href={item.shopifyFile.shopifyCdnUrl} target="_blank" rel="noreferrer">{item.shopifyFile.shopifyCdnUrl}</a> <button type="button" className="ml-2 text-cyan-300" onClick={() => void navigator.clipboard.writeText(item.shopifyFile?.shopifyCdnUrl ?? "")}>Copy</button> <button type="button" className="ml-2 text-cyan-300" onClick={() => void handleDownload(item)}>Tải ảnh</button></p> : null}
          {item.status === "completed" && item.job ? <div className="flex flex-wrap gap-2"><button type="button" className={`${buttonClass} bg-emerald-700`} disabled={isBusy} onClick={() => void approveAndUpload(item)}>Duyệt & upload Shopify</button><button type="button" className={`${buttonClass} border border-slate-600`} disabled={isBusy} onClick={() => void handleRetry(item, false)}>Tạo lại cùng nền</button><button type="button" className={`${buttonClass} border border-slate-600`} disabled={isBusy} onClick={() => void handleRetry(item, true)}>Đổi nền</button></div> : null}
        </article>)}
      </section>
    </div>
  </section>;
}
