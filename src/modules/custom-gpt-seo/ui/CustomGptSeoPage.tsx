import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AppIcon } from "../../../shared/components/AppIcon";
import { useDialogFocus } from "../../../shared/hooks/useDialogFocus";
import { persistBrowserActiveStoreId, readActiveStoreId } from "../../../shared/active-store";
import { resolveSeoQueueStoreId } from "../../../shared/seo-queue-navigation";

import type { CustomGptClient, GptQueuePage, SeoQueueStore } from "../service";
import type { GptSeoJob, GptSeoSettings } from "../types";

import { StoreSelector } from "./StoreSelector";
import { AgentAccessPanel } from "./AgentAccessPanel";
import {
  buildQueueSummaries,
  canRetryJob,
  filterQueueJobs,
  getBatchOwnerLabel,
  getJobSourceTitle,
  getProviderPresentation,
  getStatusesForGroup,
} from "./seo-queue-view-model";
import type { QueueProviderFilter, QueueStatusGroup } from "./seo-queue-view-model";
import { QUEUE_FIELD_CLASS_NAME as FIELD_CLASS_NAME, QUEUE_PRIMARY_BUTTON_CLASS_NAME as PRIMARY_BUTTON_CLASS_NAME, QUEUE_SECONDARY_BUTTON_CLASS_NAME as SECONDARY_BUTTON_CLASS_NAME } from "./queue-styles";
import { QueueJobDetail } from "./components/QueueJobDetail";
import { QueueJobsTable } from "./components/QueueJobsTable";

interface Notice {
  readonly kind: "success" | "error";
  readonly text: string;
}

const TRANSFERABLE_STATUSES = ["PENDING", "WAITING_INPUT", "NEEDS_CHANGES", "FAILED"] as const;

export function CustomGptSeoPage({ client }: { readonly client: CustomGptClient }): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStoreId = useRef(resolveSeoQueueStoreId(
    searchParams,
    typeof window === "undefined" ? undefined : readActiveStoreId(window.localStorage),
  )).current;
  const [storeId, setStoreId] = useState(initialStoreId);
  const [stores, setStores] = useState<readonly SeoQueueStore[]>([{ storeId: initialStoreId, shopDomain: "" }]);
  const [isStoreListLoading, setIsStoreListLoading] = useState(true);
  const [settings, setSettings] = useState<GptSeoSettings | null>(null);
  const [queue, setQueue] = useState<GptQueuePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<GptSeoJob | null>(null);
  const [query, setQuery] = useState("");
  const [statusGroup, setStatusGroup] = useState<QueueStatusGroup>("all");
  const [providerFilter, setProviderFilter] = useState<QueueProviderFilter>("all");
  const refreshGeneration = useRef(0);
  const viewingStore = useRef(storeId);
  viewingStore.current = storeId;
  const refreshController = useRef<AbortController | null>(null);
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
  const [hasOpenedAgentPanel, setHasOpenedAgentPanel] = useState(false);
  const [hasQueueLoadError, setHasQueueLoadError] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const jobDialogRef = useDialogFocus({ isOpen: selectedJobId !== null, onClose: () => setSelectedJobId(null) });

  useEffect(() => {
    let isCurrent = true;
    void client.settings(storeId).then(next => { if (isCurrent) setSettings(next); }).catch(error => {
      if (isCurrent) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Không tải được cấu hình SEO." });
    });
    return () => { isCurrent = false; };
  }, [client, storeId]);

  useEffect(() => {
    let cancelled = false;
    void client.stores()
      .then(configuredStores => {
        if (cancelled) return;
        if (configuredStores.length === 0) throw new Error("Chưa có cửa hàng nào được cấu hình.");
        setStores(configuredStores.some(store => store.storeId === initialStoreId)
          ? configuredStores
          : [{ storeId: initialStoreId, shopDomain: "" }, ...configuredStores]);
      })
      .catch(error => {
        if (!cancelled) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Không tải được danh sách cửa hàng." });
      })
      .finally(() => {
        if (!cancelled) setIsStoreListLoading(false);
      });
    return () => { cancelled = true; };
  }, [client]);

  const refresh = useCallback(async (): Promise<void> => {
    const generation = ++refreshGeneration.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    try {
      const nextQueue = await client.list(storeId, offset, {
        signal: controller.signal,
        statuses: getStatusesForGroup(statusGroup),
        ...(providerFilter === "all" ? {} : { provider: providerFilter }),
      });
      if (generation !== refreshGeneration.current) return;
      setQueue(nextQueue);
      setHasQueueLoadError(false);
      setLastRefreshedAt(new Date().toLocaleTimeString("vi-VN"));
    } catch (error) {
      if (generation === refreshGeneration.current && !controller.signal.aborted) setHasQueueLoadError(true);
      throw error;
    }
  }, [client, offset, providerFilter, statusGroup, storeId]);

  useEffect(() => {
    let cancelled = false;
    setIsBusy(true);
    setHasQueueLoadError(false);
    setNotice(null);
    void refresh()
      .catch(error => {
        if (!cancelled) {
          setHasQueueLoadError(true);
          setNotice({ kind: "error", text: error instanceof Error ? error.message : "Không tải được hàng đợi." });
        }
      })
      .finally(() => {
        if (!cancelled) setIsBusy(false);
      });
    return () => { cancelled = true; refreshController.current?.abort(); };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedJobId) {
      setSelectedJob(null);
      return;
    }
    void client.job(storeId, selectedJobId)
      .then(job => { if (!cancelled) setSelectedJob(job); })
      .catch(error => {
        if (!cancelled) {
          setNotice({ kind: "error", text: error instanceof Error ? error.message : "Không tải được sản phẩm." });
          setSelectedJobId(null);
        }
      });
    return () => { cancelled = true; };
  }, [client, selectedJobId, storeId]);

  async function perform(operation: () => Promise<unknown>, successMessage: string): Promise<void> {
    setIsBusy(true);
    setNotice(null);
    try {
      await operation();
      if (viewingStore.current !== storeId) return;
      const settingsPromise = client.settings(storeId).then(nextSettings => {
        if (viewingStore.current === storeId) setSettings(nextSettings);
      });
      await Promise.all([refresh(), settingsPromise]);
      if (viewingStore.current !== storeId) return;
      if (selectedJobId) setSelectedJob(await client.job(storeId, selectedJobId));
      setNotice({ kind: "success", text: successMessage });
    } catch (error) {
      if (viewingStore.current === storeId) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Thao tác thất bại." });
    } finally {
      if (viewingStore.current === storeId) setIsBusy(false);
    }
  }

  function handleStoreChange(nextStoreId: string): void {
    if (!nextStoreId || nextStoreId === storeId) return;
    persistBrowserActiveStoreId(nextStoreId);
    setSearchParams({ storeId: nextStoreId }, { replace: true });
    refreshGeneration.current += 1;
    refreshController.current?.abort();
    setIsAgentPanelOpen(false);
    setHasOpenedAgentPanel(false);
    setHasQueueLoadError(false);
    setStoreId(nextStoreId);
    setOffset(0);
    setSettings(null);
    setQueue(null);
    setLastRefreshedAt(null);
    setSelectedJobId(null);
    setSelectedJob(null);
    setQuery("");
    setStatusGroup("all");
    setProviderFilter("all");
  }

  function handleProviderChange(provider: string): void {
    if (!settings) return;
    if (provider === "gemini" || provider === "custom_gpt" || provider === "codex_mcp") setSettings({ ...settings, provider });
  }

  function handleOpenJob(jobId: string): void {
    setSelectedJob(null);
    setSelectedJobId(jobId);
  }

  function handlePageChange(nextOffset: number): void {
    setOffset(nextOffset);
    document.getElementById("queue-list-title")?.scrollIntoView({ block: "start" });
  }

  async function handleClearQueue(): Promise<void> {
    const confirmed = window.confirm(`Dọn Queue của store ${storeId}?\n\nSản phẩm đang được xử lý và lịch sử đã/đang Sync Shopify sẽ được giữ lại.`);
    if (!confirmed) return;
    setIsBusy(true);
    setNotice(null);
    try {
      const result = await client.clearQueue(storeId);
      if (viewingStore.current !== storeId) return;
      setSelectedJobId(null);
      setSelectedJob(null);
      setOffset(0);
      if (offset === 0) await refresh();
      setNotice({
        kind: "success",
        text: `Đã dọn ${result.cleared} sản phẩm và lưu trữ ${result.archived} sản phẩm đã bàn giao/đồng bộ. Giữ lại ${result.preservedActive} đang xử lý và ${result.preservedFailed} cần xử lý lỗi.`,
      });
    } catch (error) {
      if (viewingStore.current === storeId) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Không dọn được Queue." });
    } finally {
      if (viewingStore.current === storeId) setIsBusy(false);
    }
  }

  const summaries = useMemo(() => buildQueueSummaries(queue?.jobs ?? [], queue?.counts), [queue]);
  const visibleSummaries = summaries.filter(summary => summary.key !== "cancelled");
  const filteredJobs = useMemo(
    () => filterQueueJobs(queue?.jobs ?? [], { query, group: statusGroup, provider: providerFilter }),
    [providerFilter, query, queue, statusGroup],
  );
  const totalCount = summaries.reduce((total, summary) => total + summary.count, 0);
  const canTransferSelectedJob = selectedJob ? TRANSFERABLE_STATUSES.some(status => status === selectedJob.status) : false;

  return (
    <section className="space-y-5" aria-labelledby="seo-queue-title">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 id="seo-queue-title" className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">SEO Queue</h1>
          <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">Theo dõi tiến độ, xử lý sản phẩm bị gián đoạn và chuyển kết quả sang bước duyệt.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <StoreSelector stores={stores} selectedStoreId={storeId} isLoading={isStoreListLoading} onChange={handleStoreChange} />
          <button type="button" disabled={isBusy} onClick={() => void perform(async () => undefined, "Đã cập nhật hàng đợi.")} className={SECONDARY_BUTTON_CLASS_NAME}><AppIcon name="refresh" className={`h-4 w-4 ${isBusy ? "animate-spin" : ""}`} />{isBusy ? "Đang tải…" : "Làm mới"}</button>
          <Link className={PRIMARY_BUTTON_CLASS_NAME} to={`/seo-review?storeId=${encodeURIComponent(storeId)}`}>Mở SEO Review<AppIcon name="arrow" /></Link>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700">
        <nav aria-label="Khu vực SEO Queue" className="flex gap-6">
          <button type="button" aria-pressed={!isAgentPanelOpen} aria-controls="seo-queue-workspace" onClick={() => setIsAgentPanelOpen(false)} className={`inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium ${!isAgentPanelOpen ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"}`}><AppIcon name="queue" />Hàng đợi</button>
          <button type="button" aria-pressed={isAgentPanelOpen} aria-controls="seo-worker-workspace" onClick={() => { setHasOpenedAgentPanel(true); setIsAgentPanelOpen(true); }} className={`inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium ${isAgentPanelOpen ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"}`}><AppIcon name="code" />Máy & phiên chạy</button>
        </nav>
        <p role="status" className="pb-3 text-xs text-slate-500 dark:text-slate-400">{isBusy ? "Đang cập nhật hàng đợi…" : lastRefreshedAt ? `Cập nhật ${lastRefreshedAt} · Làm mới để lấy trạng thái mới nhất` : "Chưa tải được trạng thái hàng đợi"}</p>
      </div>

      {notice && (
        <div role={notice.kind === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${notice.kind === "success" ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300" : "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300"}`}>
          <span aria-hidden="true">{notice.kind === "success" ? "✓" : "!"}</span><span>{notice.text}</span>
        </div>
      )}

      <div id="seo-queue-workspace" hidden={isAgentPanelOpen} className="space-y-5">
      <div className="grid grid-cols-4 gap-3" aria-label="Tổng quan hàng đợi của store">
        {visibleSummaries.map(summary => (
          <button key={summary.key} type="button" disabled={isBusy} aria-pressed={statusGroup === summary.key} onClick={() => { setOffset(0); setStatusGroup(current => current === summary.key ? "all" : summary.key); }} className={`rounded-xl border p-4 text-left transition disabled:cursor-wait ${statusGroup === summary.key ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:border-blue-400 dark:bg-blue-950/50 dark:ring-blue-400" : "border-slate-200 bg-white hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"}`}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-medium text-slate-700 dark:text-slate-300">{summary.label}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{summary.description}</p></div>
              <span className={`text-3xl font-semibold tabular-nums ${summary.accentClassName}`}>{queue ? summary.count : "—"}</span>
            </div>
          </button>
        ))}
      </div>

      {queue && queue.activeBatches.length > 0 && <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
        <span className="inline-flex items-center gap-2"><AppIcon name="clock" />{queue.activeBatches.length} batch đang được máy xử lý nhận</span>
        <button type="button" onClick={() => { setHasOpenedAgentPanel(true); setIsAgentPanelOpen(true); }} className="font-medium underline underline-offset-4">Xem máy & phiên chạy</button>
      </div>}

      <section className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" aria-labelledby="queue-list-title">
        <div className="space-y-4 border-b border-slate-200 p-5 dark:border-slate-700">
          <div className="flex items-center justify-between gap-4">
            <div><div className="flex items-center gap-2"><h2 id="queue-list-title" className="scroll-mt-24 font-semibold text-slate-900 dark:text-slate-100">Sản phẩm trong hàng đợi</h2><span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{queue ? totalCount : "—"}</span></div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Tổng quan tính trên toàn store · Bộ lọc trạng thái và AI áp dụng trước phân trang.</p></div>
            <button type="button" aria-pressed={statusGroup === "all"} disabled={isBusy} onClick={() => { setOffset(0); setStatusGroup("all"); }} className={SECONDARY_BUTTON_CLASS_NAME}>Tất cả trạng thái</button>
          </div>
          <div className="grid grid-cols-[minmax(220px,1fr)_180px_180px] gap-3">
            <label className="relative"><span className="sr-only">Tìm sản phẩm trong trang này</span><span aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-slate-400"><AppIcon name="search" /></span><input className={`${FIELD_CLASS_NAME} w-full pl-9`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm trong trang: tên, ASIN, handle, job ID…" /></label>
            <label><span className="sr-only">Lọc trạng thái</span><select className={`${FIELD_CLASS_NAME} w-full`} value={statusGroup} disabled={isBusy} onChange={event => { setOffset(0); setStatusGroup(event.target.value as QueueStatusGroup); }}><option value="all">Mọi trạng thái</option><option value="waiting">Chờ xử lý</option><option value="processing">Đang xử lý</option><option value="attention">Cần xử lý</option><option value="ready">Sẵn sàng duyệt</option><option value="cancelled">Đã hủy</option></select></label>
            <label><span className="sr-only">Lọc AI xử lý</span><select className={`${FIELD_CLASS_NAME} w-full`} value={providerFilter} disabled={isBusy} onChange={event => { setOffset(0); setProviderFilter(event.target.value as QueueProviderFilter); }}><option value="all">Mọi AI xử lý</option><option value="gemini">Gemini</option><option value="custom_gpt">GPT Custom</option><option value="codex_mcp">Codex MCP</option></select></label>
          </div>
          {(query || statusGroup !== "all" || providerFilter !== "all") && <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400"><span>{queue ? `${filteredJobs.length}/${queue.jobs.length} sản phẩm trên trang khớp bộ lọc` : "Đang tải bộ lọc…"}</span><button type="button" onClick={() => { setOffset(0); setQuery(""); setStatusGroup("all"); setProviderFilter("all"); }} className="font-medium text-blue-700 dark:text-blue-300">Xóa bộ lọc</button></div>}
        </div>

        {hasQueueLoadError ? (
          <div className="px-6 py-12 text-center"><AppIcon name="warning" className="mx-auto h-6 w-6 text-amber-600" /><h3 className="mt-3 font-medium text-slate-900 dark:text-slate-100">Chưa tải được hàng đợi</h3><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Trạng thái có thể đã thay đổi. Làm mới để kiểm tra trước khi thao tác.</p><button type="button" disabled={isBusy} className={`${SECONDARY_BUTTON_CLASS_NAME} mt-4`} onClick={() => void perform(async () => undefined, "Đã cập nhật hàng đợi.")}>Tải lại hàng đợi</button></div>
        ) : queue === null ? (
          <div className="space-y-3 p-5" role="status" aria-label="Đang tải hàng đợi">{[1, 2, 3].map(row => <div key={row} className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}</div>
        ) : filteredJobs.length > 0 ? (
          <QueueJobsTable jobs={filteredJobs} isBusy={isBusy} onOpenJob={handleOpenJob} onRetryJob={job => void perform(() => client.retry(storeId, job.id), `Đã đưa “${getJobSourceTitle(job)}” vào xử lý lại.`)} />
        ) : (
          <div className="px-6 py-14 text-center"><AppIcon name="queue" className="mx-auto h-7 w-7 text-slate-400" /><h3 className="mt-4 font-medium text-slate-900 dark:text-slate-100">{totalCount === 0 ? "Chưa có sản phẩm trong hàng đợi" : "Không có sản phẩm khớp bộ lọc trên trang này"}</h3><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{totalCount === 0 ? "Sản phẩm được gửi sang SEO sẽ xuất hiện tại đây." : "Thử đổi trạng thái, xóa từ khóa hoặc chuyển trang. Tìm kiếm chỉ áp dụng trên trang đang xem."}</p></div>
        )}

        {queue && (queue.jobs.length > 0 || offset > 0) && (
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-5 py-3 text-xs text-slate-500 dark:text-slate-400"><span>Trang {Math.floor(offset / 50) + 1} · hiển thị {filteredJobs.length}/{queue.jobs.length} sản phẩm trên trang</span><div className="flex gap-2"><button type="button" disabled={offset === 0 || isBusy} onClick={() => handlePageChange(Math.max(0, offset - 50))} className={SECONDARY_BUTTON_CLASS_NAME}>Trang trước</button><button type="button" disabled={queue.nextOffset === null || isBusy} onClick={() => handlePageChange(queue.nextOffset ?? offset)} className={SECONDARY_BUTTON_CLASS_NAME}>Trang sau</button></div></div>
        )}
      </section>

      <details className="group rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4"><div><h2 className="font-medium text-slate-900 dark:text-slate-100">Cấu hình & thao tác khác</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{settings ? `${getProviderPresentation(settings.provider).label} · ${settings.batchSize} sản phẩm/lượt · ${settings.language}` : "Đang tải cấu hình…"}</p></div><span className="text-slate-500 dark:text-slate-400 transition group-open:rotate-180" aria-hidden="true">⌄</span></summary>
        {settings && (
          <form className="grid gap-5 border-t border-slate-200 dark:border-slate-700 px-5 py-5 lg:grid-cols-2" onSubmit={event => { event.preventDefault(); void perform(() => client.configure(storeId, settings), "Đã lưu cấu hình xử lý SEO."); }}>
            <label className="space-y-2"><span className="block text-sm font-medium text-slate-700 dark:text-slate-300">AI xử lý</span><select className={`${FIELD_CLASS_NAME} w-full`} value={settings.provider} onChange={event => handleProviderChange(event.target.value)}><option value="gemini">Gemini — tự động qua API</option><option value="custom_gpt">GPT Custom — xử lý thủ công</option><option value="codex_mcp">Codex MCP — xử lý thủ công</option></select><span className="block text-xs text-slate-500 dark:text-slate-400">Chỉ áp dụng cho sản phẩm mới; sản phẩm đang chạy giữ nguyên AI hiện tại.</span></label>
            <div className="grid grid-cols-2 gap-3"><label className="space-y-2"><span className="block text-sm font-medium text-slate-700 dark:text-slate-300">Số sản phẩm mỗi lượt</span><input className={`${FIELD_CLASS_NAME} w-full`} type="number" min={1} max={10} value={settings.batchSize} onChange={event => setSettings({ ...settings, batchSize: Number(event.target.value) })} /></label><label className="space-y-2"><span className="block text-sm font-medium text-slate-700 dark:text-slate-300">Ngôn ngữ đầu ra</span><input className={`${FIELD_CLASS_NAME} w-full`} value={settings.language} onChange={event => setSettings({ ...settings, language: event.target.value })} /></label></div>
            <label className="space-y-2 lg:col-span-2"><span className="block text-sm font-medium text-slate-700 dark:text-slate-300">Quy tắc nội dung</span><textarea className={`${FIELD_CLASS_NAME} min-h-24 w-full resize-y`} value={settings.instructions} onChange={event => setSettings({ ...settings, instructions: event.target.value })} /></label>
            <div className="lg:col-span-2"><button type="submit" disabled={isBusy} className={PRIMARY_BUTTON_CLASS_NAME}>Lưu cấu hình</button></div>
          </form>
        )}
        <div className="flex items-center justify-between gap-6 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
          <div><h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">Dọn hàng đợi của store {storeId}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Thao tác trên toàn store, không chỉ những dòng đang lọc. Bạn sẽ được yêu cầu xác nhận.</p></div>
          <button type="button" disabled={isBusy || totalCount === 0 || hasQueueLoadError} onClick={() => void handleClearQueue()} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/50"><AppIcon name="trash" />Dọn Queue</button>
        </div>
      </details>

      </div>

      <section id="seo-worker-workspace" hidden={!isAgentPanelOpen} className="space-y-5" aria-label="Máy và phiên chạy SEO">
        {hasOpenedAgentPanel && <AgentAccessPanel key={storeId} client={client} storeId={storeId} />}
        {queue && queue.activeBatches.length > 0 && <section className="overflow-hidden rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50" aria-labelledby="active-batches-title">
          <h2 id="active-batches-title" className="border-b border-blue-200 px-4 py-3 text-sm font-medium text-blue-800 dark:border-blue-800 dark:text-blue-200">Batch đang được xử lý ({queue.activeBatches.length})</h2>
          <div className="divide-y divide-blue-200 dark:divide-blue-800">{queue.activeBatches.map(batch => <div key={batch.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 text-blue-800 dark:text-blue-200"><p className="text-sm font-medium">{getBatchOwnerLabel(batch.ownerId)} · {getProviderPresentation(batch.provider).label}</p><p className="mt-1 truncate font-mono text-xs">{batch.id}</p><p className="mt-1 text-xs">{batch.jobs.length} sản phẩm · hết hạn {new Date(batch.expiresAt).toLocaleString("vi-VN")}</p></div>
            <button type="button" disabled={isBusy} onClick={() => void perform(() => client.release(storeId, batch.id), `Đã thu hồi batch của ${getBatchOwnerLabel(batch.ownerId)}.`)} className={SECONDARY_BUTTON_CLASS_NAME}>Thu hồi</button>
          </div>)}</div>
        </section>}
      </section>

      {selectedJobId && (
        <div ref={jobDialogRef} tabIndex={-1} className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="job-detail-title">
          <button type="button" tabIndex={-1} aria-label="Đóng chi tiết sản phẩm" onClick={() => setSelectedJobId(null)} className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
          <aside className="absolute inset-y-0 right-0 w-full max-w-[760px] overflow-y-auto border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-5 py-4 backdrop-blur"><div><p className="text-xs font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">Chi tiết sản phẩm</p><h2 id="job-detail-title" className="mt-1 max-w-xl line-clamp-2 font-semibold text-slate-900 dark:text-slate-100">{selectedJob ? getJobSourceTitle(selectedJob) : "Đang tải…"}</h2></div><button type="button" aria-label="Đóng" onClick={() => setSelectedJobId(null)} className="rounded-lg p-2 text-slate-600 dark:text-slate-400 transition hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100">✕</button></div>
            {selectedJob ? <QueueJobDetail job={selectedJob} storeId={storeId} isBusy={isBusy} canTransfer={canTransferSelectedJob} onRetry={() => void perform(() => client.retry(storeId, selectedJob.id), "Đã đưa sản phẩm vào xử lý lại.")} onTransfer={provider => void perform(() => client.transfer(storeId, selectedJob.id, provider), `Đã chuyển sang ${getProviderPresentation(provider).label}.`)} /> : <div className="space-y-3 p-5" aria-label="Đang tải chi tiết sản phẩm">{[1, 2, 3, 4].map(row => <div key={row} className="h-20 animate-pulse rounded-lg bg-white dark:bg-slate-900" />)}</div>}
          </aside>
        </div>
      )}
    </section>
  );
}
