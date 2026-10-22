import { useEffect, useMemo, useRef, useState } from "react";

import { encodeImageFile } from "../service";
import {
  loadStoreProducts,
  readReviewImageSettings,
  saveStoreProducts,
  writeReviewImageSettings,
} from "../session-storage";
import type { PersistedReviewProductImage as ReviewProductImage } from "../session-storage";
import { buildTemplateSequence, getReviewImageStorePreset } from "../store-presets";
import type { ReviewImageClient, ReviewImageJob, ReviewImageScope, ReviewImageShopifyFile, ReviewImageTemplate } from "../types";

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

async function readImageDimensions(dataUrl: string): Promise<string> {
  if (typeof Image === "undefined") return "1200 × 1200";
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || 1200;
      const height = image.naturalHeight || 1200;
      resolve(`${width} × ${height}`);
    };
    image.onerror = () => resolve("1200 × 1200");
    image.src = dataUrl;
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
  const initialSettings = useMemo(() => readReviewImageSettings(), []);
  const [internalStoreId, setInternalStoreId] = useState(() =>
    initialSettings.selectedStoreId && stores.includes(initialSettings.selectedStoreId)
      ? initialSettings.selectedStoreId
      : (stores[0] ?? "preaureum"),
  );
  const storeId = controlledStoreId ?? internalStoreId;
  const preset = useMemo(() => getReviewImageStorePreset(storeId), [storeId]);
  const [scopeDrafts, setScopeDrafts] = useState<Readonly<Record<string, ReviewImageScope>>>(initialSettings.scopes);
  const scope: ReviewImageScope = preset.supportsBagSet ? (scopeDrafts[storeId] ?? preset.scope) : preset.scope;
  const [promptDrafts, setPromptDrafts] = useState<Readonly<Record<string, string>>>(initialSettings.promptDrafts);
  const prompt = promptDrafts[storeId] ?? preset.prompt;
  const [products, setProducts] = useState<readonly ReviewProductImage[]>([]);
  const [templates, setTemplates] = useState<readonly ReviewImageTemplate[] | null>(null);
  const [templateUrls, setTemplateUrls] = useState<Readonly<Record<string, string>>>({});
  const [previewTemplateNames, setPreviewTemplateNames] = useState<Readonly<Record<string, string>>>(
    initialSettings.previewTemplateNames,
  );
  const previewTemplateName = previewTemplateNames[storeId] ?? "";
  const [previewTemplateUrl, setPreviewTemplateUrl] = useState("");
  const [selectedTemplateNames, setSelectedTemplateNames] = useState<Set<string>>(new Set());
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateNotice, setTemplateNotice] = useState("");
  const [templateTab, setTemplateTab] = useState<"gallery" | "upload">("gallery");
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isSortAscending, setIsSortAscending] = useState(true);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isStopRequested, setIsStopRequested] = useState(false);
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [error, setError] = useState("");
  const [extensionConnected, setExtensionConnected] = useState<boolean | undefined>(undefined);
  const [gatewayToken, setGatewayToken] = useState(initialSettings.gatewayToken);
  const stopRequestedRef = useRef(false);
  const activeJobRef = useRef<{ readonly jobId: string; readonly itemId: string } | null>(null);
  const hydratedStoreIdRef = useRef<string | null>(null);
  const onShopifyFileRef = useRef(onShopifyFile);
  onShopifyFileRef.current = onShopifyFile;
  const isBusy = isBatchRunning || isBulkUploading || templateBusy;

  const setScope = (nextScope: ReviewImageScope): void => {
    setScopeDrafts((current) => ({ ...current, [storeId]: nextScope }));
  };

  const setPreviewTemplateName = (name: string): void => {
    setPreviewTemplateNames((current) => ({ ...current, [storeId]: name }));
  };

  useEffect(() => {
    if (initialSettings.gatewayToken) {
      client.setGatewayToken(initialSettings.gatewayToken);
    }
  }, [client, initialSettings.gatewayToken]);

  useEffect(() => {
    writeReviewImageSettings({
      selectedStoreId: storeId,
      gatewayToken,
      scopes: scopeDrafts,
      promptDrafts,
      previewTemplateNames,
    });
  }, [gatewayToken, previewTemplateNames, promptDrafts, scopeDrafts, storeId]);

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
    hydratedStoreIdRef.current = null;
    setTemplates(null);
    setTemplateUrls({});
    setSelectedTemplateNames(new Set());
    setTemplateNotice("");
    setProducts([]);

    const resumeJobAfterReload = async (itemId: string, jobId: string): Promise<void> => {
      try {
        while (active) {
          const job = await client.job(jobId);
          if (!active) return;
          updateProduct(itemId, { job, status: job.status });
          if (job.status === "completed") {
            const resultDataUrl = await blobToDataUrl(await client.image(job.job_id));
            if (active) updateProduct(itemId, { job, status: "completed", resultDataUrl });
            return;
          }
          if (job.status === "failed") {
            updateProduct(itemId, { job, status: "failed", error: job.error || "Tạo ảnh thất bại." });
            return;
          }
          if (job.status === "cancelled") {
            updateProduct(itemId, { job, status: "cancelled", error: undefined });
            return;
          }
          await delay(POLL_INTERVAL_MS);
        }
      } catch (cause) {
        if (active) {
          updateProduct(itemId, {
            status: "failed",
            error: cause instanceof Error ? cause.message : "Không thể khôi phục trạng thái ảnh.",
          });
        }
      }
    };

    const restoreMissingResultImage = async (itemId: string, jobId: string): Promise<void> => {
      try {
        const resultDataUrl = await blobToDataUrl(await client.image(jobId));
        if (active) updateProduct(itemId, { resultDataUrl });
      } catch {
        // Keep existing item metadata if result image cannot be re-fetched.
      }
    };

    void loadStoreProducts(storeId).then((restored) => {
      if (!active) return;
      hydratedStoreIdRef.current = storeId;
      setProducts((current) => {
        if (current.length === 0) return restored;
        const existingIds = new Set(current.map((item) => item.id));
        return [...restored.filter((item) => !existingIds.has(item.id)), ...current];
      });
      for (const item of restored) {
        if (item.shopifyFile) {
          onShopifyFileRef.current?.(storeId, item.shopifyFile);
        }
        if ((item.status === "queued" || item.status === "running") && item.job?.job_id) {
          void resumeJobAfterReload(item.id, item.job.job_id);
        } else if ((item.status === "completed" || item.status === "uploaded") && !item.resultDataUrl && item.job?.job_id) {
          void restoreMissingResultImage(item.id, item.job.job_id);
        }
      }
    });

    void client.listTemplates(storeId).then((items) => {
      if (!active) return;
      setTemplates(items);
      setPreviewTemplateNames((current) => {
        const saved = current[storeId];
        if (saved && items.some((item) => item.name === saved)) return current;
        const fallback = items[0]?.name ?? "";
        return fallback ? { ...current, [storeId]: fallback } : current;
      });
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không tải được template.");
    });
    return () => { active = false; };
  }, [client, storeId]);

  useEffect(() => {
    if (hydratedStoreIdRef.current !== storeId) return;
    void saveStoreProducts(storeId, products);
  }, [products, storeId]);

  useEffect(() => {
    if (!templates || templates.length === 0) {
      setTemplateUrls({});
      return;
    }
    let active = true;
    const createdUrls: string[] = [];
    void Promise.all(
      templates.map(async (template) => {
        try {
          const blob = await client.template(storeId, template.name);
          const objectUrl = URL.createObjectURL(blob);
          createdUrls.push(objectUrl);
          return [template.name, objectUrl] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      const nextUrls: Record<string, string> = {};
      for (const entry of entries) {
        if (entry) nextUrls[entry[0]] = entry[1];
      }
      setTemplateUrls(nextUrls);
    });
    return () => {
      active = false;
      for (const url of createdUrls) URL.revokeObjectURL(url);
    };
  }, [client, storeId, templates]);

  useEffect(() => {
    if (!previewTemplateName) {
      setPreviewTemplateUrl("");
      return;
    }
    const cachedUrl = templateUrls[previewTemplateName];
    if (cachedUrl) {
      setPreviewTemplateUrl(cachedUrl);
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
  }, [client, previewTemplateName, storeId, templateUrls]);

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
        const dataUrl = await encodeImageFile(file);
        const dimensions = await readImageDimensions(dataUrl);
        additions.push({ id: makeItemId(), name: file.name || "Ảnh đã dán", dataUrl, dimensions, status: "ready" });
      } catch (cause) {
        setError(cause instanceof Error ? `${file.name}: ${cause.message}` : "Ảnh sản phẩm không hợp lệ.");
      }
    }
    if (additions.length) setProducts((current) => [...current, ...additions]);
  }

  function handleSortProducts(): void {
    if (isBusy || products.length < 2) return;
    const nextAscending = !isSortAscending;
    setIsSortAscending(nextAscending);
    setProducts((current) =>
      [...current].sort((left, right) =>
        nextAscending
          ? left.name.localeCompare(right.name, undefined, { numeric: true })
          : right.name.localeCompare(left.name, undefined, { numeric: true }),
      ),
    );
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

  function handleProductDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (isBatchRunning) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void addProductFiles(files);
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
  const fieldClass = "mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300 dark:focus:border-blue-800";
  const buttonClass = "rounded-xl px-4 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";
  const cardClass = "rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-xs";

  return (
    <section className="space-y-5 text-slate-900 dark:text-slate-100">
      {extensionConnected === false ? (
        <p role="status" className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-3.5 text-xs leading-5 text-amber-700 dark:text-amber-300">
          Chưa kết nối được extension tạo ảnh. Hãy mở tab ChatGPT, ghim tab trong extension và kết nối đến FFP; nếu vẫn lỗi, kiểm tra Gateway token.
        </p>
      ) : null}

      {!embedded ? (
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Tạo ảnh review</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Tạo ảnh theo template, duyệt và đưa vào Shopify Files.
          </p>
        </header>
      ) : null}

      {showStoreSelector ? (
        <section className={cardClass}>
          <div className="grid gap-4 lg:grid-cols-12 lg:items-center">
            <div className="flex items-center gap-3.5 lg:col-span-6">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M6 8h12l-1 12H7L6 8Z" />
                  <path d="M9 8V6a3 3 0 0 1 6 0v2" />
                </svg>
              </span>
              <label className="min-w-0 flex-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                1. Chọn store và loại sản phẩm
                <select
                  className={`${fieldClass} mt-1.5 font-medium`}
                  disabled={isBusy}
                  value={storeId}
                  onChange={(event) => handleStoreChange(event.target.value)}
                >
                  {stores.map((store) => (
                    <option key={store} value={store}>
                      {getStoreLabel(store)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/40 px-4 py-3 text-xs leading-5 text-blue-700 dark:text-blue-300 lg:col-span-6">
              <p>
                Store quyết định kho ảnh nền và prompt phù hợp với sản phẩm. Hiện tại: <strong>{preset.productLabel}</strong>.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-12">
        {/* Left Column: Steps 1, 2, 3 */}
        <div className="space-y-5 lg:col-span-7">
          {/* Step 1 Card: Chuẩn bị ảnh nền review */}
          <section className={`${cardClass} space-y-4`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  1
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Chuẩn bị ảnh nền review</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Làm lần lượt theo các bước bên dưới. Mỗi ảnh sản phẩm sẽ nhận một ảnh nền từ kho template của store.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-expanded={isGuideOpen}
                onClick={() => setIsGuideOpen((current) => !current)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 text-slate-700 dark:text-slate-300">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Hướng dẫn
              </button>
            </div>

            <div hidden={!isGuideOpen} className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 p-4 text-xs">
              <p className="leading-5 text-slate-600 dark:text-slate-300">
                1. Chọn hoặc bổ sung ảnh nền trong kho template của store. 2. Tải hoặc dán các ảnh sản phẩm cần tạo review. 3. Kiểm tra prompt rồi nhấn Tạo ảnh review.
              </p>
              <div className="space-y-2 border-t border-slate-200 dark:border-slate-700 pt-3">
                <p className="font-semibold text-slate-700 dark:text-slate-200">Cấu hình nâng cao · Gateway token</p>
                <div className="flex gap-2">
                  <input
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    type="password"
                    placeholder="Nhập Gateway token nếu cần..."
                    value={gatewayToken}
                    onChange={(event) => setGatewayToken(event.target.value)}
                  />
                  <button
                    type="button"
                    className={`${buttonClass} shrink-0 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-100`}
                    onClick={() => void applyGatewayToken()}
                  >
                    Kết nối
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Step 2 Card: Chọn ảnh nền từ kho */}
          <section className={`${cardClass} space-y-4`}>
            <div className="flex items-start justify-between gap-4">
              <button
                type="button"
                aria-expanded={isTemplateManagerOpen}
                aria-controls="review-image-template-section"
                onClick={() => setIsTemplateManagerOpen((current) => !current)}
                className="flex min-w-0 flex-1 items-start gap-3.5 text-left"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  2
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    <span className="sr-only">2. Chuẩn bị kho ảnh nền · </span>Chọn ảnh nền từ kho
                    {templates ? (
                      <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        ({templates.length} template)
                      </span>
                    ) : null}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Chỉ lấy bối cảnh của template; sản phẩm có sẵn trong ảnh sẽ được thay bằng sản phẩm ở mục 3. Template được xoay ngẫu nhiên khi tạo ảnh.
                    <span className="sr-only"> Tất cả template trong kho sẽ được xoay vòng ngẫu nhiên khi tạo lô ảnh.</span>
                  </p>
                </div>
              </button>
              <button
                type="button"
                aria-expanded={isTemplateManagerOpen}
                aria-controls="review-image-template-section"
                onClick={() => setIsTemplateManagerOpen((current) => !current)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 transition hover:bg-blue-50 dark:hover:bg-blue-950/40"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                <span>{isTemplateManagerOpen ? "Thu gọn kho template" : "Xem kho template"}</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`h-3.5 w-3.5 transition-transform ${isTemplateManagerOpen ? "rotate-180" : ""}`}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>

            <div id="review-image-template-section" hidden={!isTemplateManagerOpen} className="space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4">
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100/90 dark:bg-slate-800 p-1.5">
                <button
                  type="button"
                  aria-pressed={templateTab === "gallery"}
                  onClick={() => setTemplateTab("gallery")}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
                    templateTab === "gallery"
                      ? "bg-white dark:bg-slate-900 font-semibold text-blue-600 dark:text-blue-400 shadow-xs"
                      : "font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  Chọn từ kho template
                </button>
                <button
                  type="button"
                  aria-pressed={templateTab === "upload"}
                  onClick={() => setTemplateTab("upload")}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
                    templateTab === "upload"
                      ? "bg-white dark:bg-slate-900 font-semibold text-blue-600 dark:text-blue-400 shadow-xs"
                      : "font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M12 16V4" />
                    <path d="m7 9 5-5 5 5" />
                    <path d="M4 16v4h16v-4" />
                  </svg>
                  Tải ảnh nền mới
                </button>
              </div>

              {templateNotice ? (
                <p role="status" className="rounded-xl bg-blue-50/80 dark:bg-blue-950/50 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                  {templateNotice}
                </p>
              ) : null}

              {/* Gallery Grid */}
              <div hidden={templateTab !== "gallery"}>
              {templates === null ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  {Array.from({ length: 10 }).map((_, index) => (
                    <div
                      key={index}
                      className="aspect-square animate-pulse rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800"
                    />
                  ))}
                </div>
              ) : templates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Store chưa có template. Hãy chuyển sang tab Tải ảnh nền mới để thêm template.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  {templates.map((template) => {
                    const isSelected = previewTemplateName === template.name;
                    const thumbUrl = templateUrls[template.name] ?? (isSelected ? previewTemplateUrl : "");

                    return (
                      <button
                        key={template.name}
                        type="button"
                        onClick={() => setPreviewTemplateName(template.name)}
                        title={template.name}
                        className={`group relative aspect-square overflow-hidden rounded-xl border-2 bg-slate-100 dark:bg-slate-800 text-left transition ${
                          isSelected
                            ? "border-blue-600 ring-2 ring-blue-600/20"
                            : "border-slate-200/80 dark:border-slate-700 hover:border-blue-300"
                        }`}
                      >
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={`Template ${template.name}`}
                            className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center p-2 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {template.name}
                          </span>
                        )}
                        {isSelected ? (
                          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white shadow-xs">
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                              <path d="m5 12 4 4L19 6" />
                            </svg>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
              </div>

              {/* Upload & Manage Templates Panel */}
              <div hidden={templateTab !== "upload"} className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 p-4 text-xs">
                <label className="block font-semibold text-blue-700 dark:text-blue-300">
                  Thêm ảnh nền mới vào kho
                  <input
                    className={`${fieldClass} border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900`}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    disabled={templateBusy}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void handleTemplateUpload(files);
                    }}
                  />
                </label>
                <div
                  className="rounded-xl border border-dashed border-blue-300 dark:border-blue-800 bg-white dark:bg-slate-900 p-3 text-center text-blue-700 dark:text-blue-300 transition focus:border-blue-400 focus:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                  tabIndex={0}
                  role="group"
                  aria-label="Vùng dán ảnh template"
                  onPaste={handleTemplatePaste}
                >
                  Hoặc nhấn vào đây rồi Ctrl+V để dán một hay nhiều ảnh nền
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Checkbox chỉ dùng để đánh dấu template cần xóa. Nhấn tên template để xem ảnh lớn.
                </p>
                {templates && templates.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-2 flex gap-3 text-xs">
                        <button
                          type="button"
                          className="font-semibold text-blue-700 dark:text-blue-300"
                          onClick={() => setSelectedTemplateNames(new Set(templates.map((template) => template.name)))}
                        >
                          Đánh dấu tất cả
                        </button>
                        <button
                          type="button"
                          className="text-slate-600 dark:text-slate-400"
                          onClick={() => setSelectedTemplateNames(new Set())}
                        >
                          Bỏ đánh dấu
                        </button>
                      </div>
                      <ul className="max-h-56 space-y-1 overflow-auto">
                        {templates.map((template) => (
                          <li
                            key={template.name}
                            className={`flex items-center gap-2 rounded-lg border p-2 transition ${
                              previewTemplateName === template.name
                                ? "border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60"
                                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            }`}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Đánh dấu xóa ${template.name}`}
                              checked={selectedTemplateNames.has(template.name)}
                              onChange={() =>
                                setSelectedTemplateNames((current) => {
                                  const next = new Set(current);
                                  if (next.has(template.name)) next.delete(template.name);
                                  else next.add(template.name);
                                  return next;
                                })
                              }
                            />
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left text-xs"
                              onClick={() => setPreviewTemplateName(template.name)}
                            >
                              {template.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <figure className="flex min-h-40 items-center justify-center rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 p-2">
                      {previewTemplateUrl ? (
                        <img className="max-h-56 rounded-lg object-contain" src={previewTemplateUrl} alt={`Template ${previewTemplateName}`} />
                      ) : (
                        <figcaption className="text-slate-500 dark:text-slate-400">Nhấn tên template để xem ảnh.</figcaption>
                      )}
                    </figure>
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`${buttonClass} border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300`}
                  disabled={!selectedTemplateNames.size || templateBusy}
                  onClick={() => void handleDeleteTemplates()}
                >
                  {templateBusy ? "Đang xử lý…" : `Xóa template đã đánh dấu (${selectedTemplateNames.size})`}
                </button>
              </div>
            </div>
          </section>

          {/* Step 3 Card: Thêm ảnh sản phẩm cần tạo review */}
          <section className={`${cardClass} space-y-4`}>
            <div className="flex items-start gap-3.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                3
              </span>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  <span className="sr-only">3. </span>Thêm ảnh sản phẩm cần tạo review
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Lấy đúng sản phẩm trong ảnh này, bỏ nền gốc và đặt vào bối cảnh ở mục 2. Mỗi ảnh đầu vào sẽ tạo một ảnh review riêng.
                </p>
              </div>
            </div>

            <div
              className="rounded-2xl border-2 border-dashed border-blue-200 dark:border-blue-800/80 bg-blue-50/25 dark:bg-slate-800/40 px-6 py-7 text-center transition hover:border-blue-400 hover:bg-blue-50/40 focus:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-600/30"
              tabIndex={0}
              role="group"
              aria-label="Vùng dán ảnh sản phẩm"
              onPaste={handleProductPaste}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleProductDrop}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mx-auto h-10 w-10 text-blue-600 dark:text-blue-400"
              >
                <path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" />
                <path d="M12 12v9" />
                <path d="m16 16-4-4-4 4" />
              </svg>
              <p className="mt-2.5 text-sm font-bold text-slate-800 dark:text-slate-100">Kéo thả ảnh sản phẩm vào đây</p>
              <p className="mt-0.5 text-xs text-slate-400">hoặc</p>
              <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                <span>Chọn file ảnh</span>
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  disabled={isBatchRunning}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    void addProductFiles(files);
                  }}
                />
              </label>
              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                Hỗ trợ: JPG, PNG, WEBP <span className="mx-1.5 text-slate-300 dark:text-slate-600">|</span> Có thể chọn nhiều file
                <span className="sr-only"> · Ctrl+V để dán ảnh sản phẩm; có thể dán thêm nhiều lần</span>
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Đã chọn {products.length} ảnh sản phẩm
                </p>
                <button
                  type="button"
                  disabled={isBatchRunning || products.length === 0}
                  onClick={() => setProducts([])}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 transition hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="m5 6 1 14h12l1-14" />
                  </svg>
                  Xóa tất cả
                </button>
              </div>

              {products.length > 0 ? (
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                  {products.map((item) => (
                    <figure
                      key={item.id}
                      className="relative aspect-square rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 p-1.5"
                    >
                      <img className="h-full w-full rounded-lg object-cover" src={item.dataUrl} alt={item.name} />
                      <figcaption className="sr-only">{item.name}</figcaption>
                      {item.status === "ready" && !isBatchRunning ? (
                        <button
                          type="button"
                          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800/80 text-xs font-bold text-white transition hover:bg-rose-600"
                          aria-label={`Xóa ${item.name}`}
                          onClick={() => setProducts((current) => current.filter((candidate) => candidate.id !== item.id))}
                        >
                          ×
                        </button>
                      ) : null}
                    </figure>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        {/* Right Column: Danh sách ảnh & Prompt / Actions */}
        <div className="space-y-5 lg:col-span-5">
          {/* Card 1: Danh sách ảnh */}
          <section className={`${cardClass} space-y-3.5`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Danh sách ảnh ({products.length})
              </h2>
              <div className="flex items-center gap-2">
                {completedCount > 0 ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                    disabled={!completedCount || isBusy}
                    onClick={() => void handleBulkApproveAndUpload()}
                  >
                    {isBulkUploading ? "Đang upload…" : `Duyệt & upload tất cả (${completedCount})`}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sr-only"
                    disabled={!completedCount || isBusy}
                    onClick={() => void handleBulkApproveAndUpload()}
                  >
                    {isBulkUploading ? "Đang upload…" : `Duyệt & upload tất cả (${completedCount})`}
                  </button>
                )}
                <button
                  type="button"
                  disabled={isBusy || products.length < 2}
                  onClick={handleSortProducts}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="m7 15-3 3-3-3" />
                    <path d="M4 18V6" />
                    <path d="m21 9-3-3-3 3" />
                    <path d="M18 6v12" />
                  </svg>
                  Sắp xếp
                </button>
              </div>
            </div>

            {!products.length ? (
              <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-400">
                Chưa có ảnh trong lô.
              </div>
            ) : (
              <div className="max-h-[460px] space-y-2.5 overflow-y-auto pr-0.5">
                {products.map((item, index) => (
                  <article
                    key={item.id}
                    className="space-y-3 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200/80 dark:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200">
                        {index + 1}
                      </span>
                      <img
                        className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white object-cover"
                        src={item.resultDataUrl ?? item.dataUrl}
                        alt={`Sản phẩm ${item.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {item.dimensions ?? "1200 × 1200"}
                          {item.status !== "ready" ? (
                            <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">· {item.status}</span>
                          ) : null}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isBatchRunning}
                        aria-label={`Xóa khỏi danh sách ${item.name}`}
                        onClick={() => setProducts((current) => current.filter((candidate) => candidate.id !== item.id))}
                        className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="m5 6 1 14h12l1-14" />
                          <path d="M10 10v6" />
                          <path d="M14 10v6" />
                        </svg>
                      </button>
                    </div>

                    {item.status !== "ready" || item.resultDataUrl || item.error || item.shopifyFile ? (
                      <div className="space-y-2.5 border-t border-slate-200/80 dark:border-slate-700 pt-2.5">
                        {item.resultDataUrl ? (
                          <img
                            className="max-h-56 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white object-contain"
                            src={item.resultDataUrl}
                            alt={`Kết quả ${item.name}`}
                          />
                        ) : item.status === "queued" || item.status === "running" ? (
                          <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                            Đang tạo ảnh…
                          </div>
                        ) : null}
                        {item.job ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">Template: {item.job.template_name}</p>
                        ) : null}
                        {item.error ? (
                          <p className="text-xs text-rose-700 dark:text-rose-300">{item.error}</p>
                        ) : null}
                        {item.shopifyFile ? (
                          <p className="break-all text-xs text-emerald-700 dark:text-emerald-300">
                            Shopify:{" "}
                            <a className="underline" href={item.shopifyFile.shopifyCdnUrl} target="_blank" rel="noreferrer">
                              {item.shopifyFile.shopifyCdnUrl}
                            </a>{" "}
                            <button
                              type="button"
                              className="ml-2 font-semibold text-blue-600 dark:text-blue-400"
                              onClick={() => void navigator.clipboard.writeText(item.shopifyFile?.shopifyCdnUrl ?? "")}
                            >
                              Copy
                            </button>{" "}
                            <button
                              type="button"
                              className="ml-2 font-semibold text-blue-600 dark:text-blue-400"
                              onClick={() => void handleDownload(item)}
                            >
                              Tải ảnh
                            </button>
                          </p>
                        ) : null}
                        {item.status === "completed" && item.job ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={`${buttonClass} bg-emerald-600 text-white hover:bg-emerald-700`}
                              disabled={isBusy}
                              onClick={() => void approveAndUpload(item)}
                            >
                              Duyệt & upload Shopify
                            </button>
                            <button
                              type="button"
                              className={`${buttonClass} border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800`}
                              disabled={isBusy}
                              onClick={() => void handleRetry(item, false)}
                            >
                              Tạo lại cùng nền
                            </button>
                            <button
                              type="button"
                              className={`${buttonClass} border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800`}
                              disabled={isBusy}
                              onClick={() => void handleRetry(item, true)}
                            >
                              Đổi nền
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Card 2: Sản phẩm cần xuất hiện, Prompt & Nút tạo */}
          <section className={`${cardClass} space-y-5`}>
            {preset.supportsBagSet ? (
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M6 8h12l-1 12H7L6 8Z" />
                    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <label className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                    Sản phẩm cần xuất hiện
                    <select
                      className={`${fieldClass} mt-1.5 font-medium`}
                      value={scope}
                      onChange={(event) => setScope(event.target.value as ReviewImageScope)}
                    >
                      <option value="main">Chỉ túi chính</option>
                      <option value="set">Cả túi và ví</option>
                    </select>
                  </label>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    Chọn phần sản phẩm sẽ xuất hiện trong ảnh review.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                      <path d="M8 13h8" />
                      <path d="M8 17h5" />
                    </svg>
                  </span>
                  <label htmlFor="review-image-prompt" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Prompt gửi ChatGPT
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => setPromptDrafts((current) => ({ ...current, [storeId]: preset.prompt }))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 transition hover:bg-blue-100 dark:hover:bg-blue-900/60"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
                  </svg>
                  Sử dụng prompt mặc định
                </button>
              </div>
              <textarea
                id="review-image-prompt"
                className="min-h-40 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 p-3 text-xs leading-5 text-slate-700 dark:text-slate-200 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300 dark:focus:border-blue-800"
                maxLength={10_000}
                value={prompt}
                onChange={(event) => setPromptDrafts((current) => ({ ...current, [storeId]: event.target.value }))}
              />
              <p className="text-right text-[11px] text-slate-400 dark:text-slate-500">
                {prompt.length}/{Math.max(2000, prompt.length)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  isBusy ||
                  !products.some((item) => item.status === "ready" || item.status === "failed" || item.status === "cancelled") ||
                  !templates?.length
                }
                onClick={() => void handleGenerateBatch()}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
                </svg>
                {isBatchRunning ? "Đang tạo lần lượt…" : "Tạo ảnh review"}
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800/80 bg-rose-50/80 dark:bg-rose-950/40 px-4 py-3 text-sm font-semibold text-rose-600 dark:text-rose-300 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!isBatchRunning || isStopRequested}
                onClick={() => void handleStopBatch()}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="m5 6 1 14h12l1-14" />
                </svg>
                {isStopRequested ? "Đang dừng…" : "Dừng tạo ảnh"}
              </button>
            </div>

            {isStopRequested ? (
              <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
                Đang hủy ảnh hiện tại và bỏ qua các ảnh còn lại trong lô…
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 p-3 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}

