import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { persistBrowserActiveStoreId, readActiveStoreId } from "../../../shared/active-store";
import { resolveSeoQueueStoreId } from "../../../shared/seo-queue-navigation";

import type { CustomGptClient, GptQueuePage, SeoQueueStore } from "../service";
import type { GptSeoJob, GptSeoSettings, SeoProvider } from "../types";

import { StoreSelector } from "./StoreSelector";
import { AgentAccessPanel } from "./AgentAccessPanel";
import {
  buildQueueSummaries,
  canRetryJob,
  filterQueueJobs,
  getBatchOwnerLabel,
  getJobProgress,
  getJobSourceTitle,
  getProviderPresentation,
  getStatusesForGroup,
  getStatusPresentation,
} from "./seo-queue-view-model";
import type { QueueProviderFilter, QueueStatusGroup } from "./seo-queue-view-model";

interface Notice {
  readonly kind: "success" | "error";
  readonly text: string;
}

const FIELD_CLASS_NAME = "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20";
const SECONDARY_BUTTON_CLASS_NAME = "inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON_CLASS_NAME = "inline-flex items-center justify-center rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50";
const TRANSFERABLE_STATUSES = ["PENDING", "WAITING_INPUT", "NEEDS_CHANGES", "FAILED"] as const;

function getSourceLabel(source: GptSeoJob["source"]): string {
  return source === "auto_seo" ? "Auto SEO" : "Amazon";
}

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
    const [nextSettings, nextQueue] = await Promise.all([
      client.settings(storeId),
      client.list(storeId, offset, {
        statuses: getStatusesForGroup(statusGroup),
        ...(providerFilter === "all" ? {} : { provider: providerFilter }),
      }),
    ]);
    if (generation !== refreshGeneration.current) return;
    setSettings(nextSettings);
    setQueue(nextQueue);
  }, [client, offset, providerFilter, statusGroup, storeId]);

  useEffect(() => {
    let cancelled = false;
    setIsBusy(true);
    setNotice(null);
    void refresh()
      .catch(error => {
        if (!cancelled) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Không tải được hàng đợi." });
      })
      .finally(() => {
        if (!cancelled) setIsBusy(false);
      });
    return () => { cancelled = true; };
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

  useEffect(() => {
    if (!selectedJobId) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setSelectedJobId(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedJobId]);

  async function perform(operation: () => Promise<unknown>, successMessage: string): Promise<void> {
    setIsBusy(true);
    setNotice(null);
    try {
      await operation();
      await refresh();
      if (selectedJobId) setSelectedJob(await client.job(storeId, selectedJobId));
      setNotice({ kind: "success", text: successMessage });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Thao tác thất bại." });
    } finally {
      setIsBusy(false);
    }
  }

  function handleStoreChange(nextStoreId: string): void {
    if (!nextStoreId || nextStoreId === storeId) return;
    persistBrowserActiveStoreId(nextStoreId);
    setSearchParams({ storeId: nextStoreId }, { replace: true });
    refreshGeneration.current += 1;
    setStoreId(nextStoreId);
    setOffset(0);
    setSettings(null);
    setQueue(null);
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

  async function handleClearQueue(): Promise<void> {
    const confirmed = window.confirm(`Dọn Queue của store ${storeId}?\n\nSản phẩm đang được xử lý và lịch sử đã/đang Sync Shopify sẽ được giữ lại.`);
    if (!confirmed) return;
    setIsBusy(true);
    setNotice(null);
    try {
      const result = await client.clearQueue(storeId);
      setSelectedJobId(null);
      setSelectedJob(null);
      setOffset(0);
      if (offset === 0) await refresh();
      setNotice({
        kind: "success",
        text: `Đã dọn ${result.cleared} sản phẩm. Giữ lại ${result.preservedActive} đang xử lý và ${result.preservedSynced} đã/đang Sync Shopify.`,
      });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Không dọn được Queue." });
    } finally {
      setIsBusy(false);
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
    <section className="space-y-6" aria-labelledby="seo-queue-title">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-300"><span aria-hidden="true">✦</span>Không gian xử lý SEO</div>
          <h1 id="seo-queue-title" className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Hàng đợi xử lý SEO</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Theo dõi sản phẩm được giao cho AI, xử lý lỗi và chuyển kết quả hoàn tất sang bước duyệt.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <StoreSelector stores={stores} selectedStoreId={storeId} isLoading={isStoreListLoading} onChange={handleStoreChange} />
          <button type="button" disabled={isBusy} onClick={() => void perform(async () => undefined, "Đã cập nhật hàng đợi.")} className={SECONDARY_BUTTON_CLASS_NAME}>{isBusy ? "Đang tải…" : "↻ Làm mới"}</button>
          <Link className={PRIMARY_BUTTON_CLASS_NAME} to={`/seo-review?storeId=${encodeURIComponent(storeId)}`}>Mở SEO Review →</Link>
        </div>
      </header>
      <details className="rounded-2xl border border-slate-800 p-4"><summary className="cursor-pointer font-medium text-cyan-300">Kết nối Codex <span className="ml-2 text-sm font-normal text-slate-400">Máy xử lý & phiên chạy</span></summary><AgentAccessPanel key={storeId} client={client} storeId={storeId} /></details>

      {notice && (
        <div role="status" className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${notice.kind === "success" ? "border-emerald-900 bg-emerald-950/40 text-emerald-200" : "border-rose-900 bg-rose-950/40 text-rose-200"}`}>
          <span aria-hidden="true">{notice.kind === "success" ? "✓" : "!"}</span><span>{notice.text}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visibleSummaries.map(summary => (
          <button key={summary.key} type="button" onClick={() => { setOffset(0); setStatusGroup(current => current === summary.key ? "all" : summary.key); }} className={`rounded-xl border p-4 text-left transition hover:border-slate-600 hover:bg-slate-900/80 ${statusGroup === summary.key ? "border-cyan-600 bg-cyan-950/20 ring-1 ring-cyan-600/30" : "border-slate-800 bg-slate-900/50"}`}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-medium text-slate-300">{summary.label}</p><p className="mt-1 text-xs text-slate-500">{summary.description}</p></div>
              <span className={`text-3xl font-semibold tabular-nums ${summary.accentClassName}`}>{summary.count}</span>
            </div>
          </button>
        ))}
      </div>

      {queue && queue.activeBatches.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-900/70 bg-amber-950/20" aria-labelledby="active-batches-title">
          <div className="border-b border-amber-900/50 px-4 py-3">
            <h2 id="active-batches-title" className="text-sm font-medium text-amber-100">Batch đang được xử lý ({queue.activeBatches.length})</h2>
          </div>
          <div className="divide-y divide-amber-900/40">
            {queue.activeBatches.map(batch => (
              <div key={batch.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span aria-hidden="true" className="mt-0.5 text-amber-300">⏳</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-100">{getBatchOwnerLabel(batch.ownerId)} · {getProviderPresentation(batch.provider).label}</p>
                    <p className="mt-1 truncate font-mono text-xs text-amber-300/60">{batch.id}</p>
                    <p className="mt-1 text-xs text-amber-300/70">{batch.jobs.length} sản phẩm · hết hạn {new Date(batch.expiresAt).toLocaleString("vi-VN")}</p>
                  </div>
                </div>
                <button type="button" disabled={isBusy} onClick={() => void perform(() => client.release(storeId, batch.id), `Đã thu hồi batch của ${getBatchOwnerLabel(batch.ownerId)}.`)} className="rounded-lg border border-amber-700 px-3 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-900/50 disabled:opacity-50">Thu hồi</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40" aria-labelledby="queue-list-title">
        <div className="border-b border-slate-800 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3"><div><div className="flex items-center gap-2"><h2 id="queue-list-title" className="font-semibold text-white">Sản phẩm trong hàng đợi</h2><span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-300">{totalCount}</span></div><p className="mt-1 text-xs text-slate-500">Store: <span className="font-mono text-slate-400">{storeId}</span></p></div><button type="button" disabled={isBusy || totalCount === 0} onClick={() => void handleClearQueue()} className="rounded-lg border border-rose-900/80 px-3 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-950/50 disabled:cursor-not-allowed disabled:opacity-40">Dọn Queue</button></div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_160px_160px]">
              <label className="relative"><span className="sr-only">Tìm sản phẩm</span><span aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 text-sm text-slate-500">⌕</span><input className={`${FIELD_CLASS_NAME} w-full pl-8`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên, handle, job ID…" /></label>
              <label><span className="sr-only">Lọc trạng thái</span><select className={`${FIELD_CLASS_NAME} w-full`} value={statusGroup} onChange={event => { setOffset(0); setStatusGroup(event.target.value as QueueStatusGroup); }}><option value="all">Mọi trạng thái</option><option value="waiting">Chờ xử lý</option><option value="processing">Đang xử lý</option><option value="attention">Cần xử lý</option><option value="ready">Sẵn sàng duyệt</option></select></label>
              <label><span className="sr-only">Lọc AI xử lý</span><select className={`${FIELD_CLASS_NAME} w-full`} value={providerFilter} onChange={event => { setOffset(0); setProviderFilter(event.target.value as QueueProviderFilter); }}><option value="all">Mọi AI xử lý</option><option value="gemini">Gemini</option><option value="custom_gpt">GPT Custom</option><option value="codex_mcp">Codex MCP</option></select></label>
            </div>
          </div>
        </div>

        {queue === null ? (
          <div className="space-y-3 p-5" aria-label="Đang tải hàng đợi">{[1, 2, 3].map(row => <div key={row} className="h-14 animate-pulse rounded-lg bg-slate-800/70" />)}</div>
        ) : filteredJobs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-950/50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-medium">Sản phẩm</th><th className="px-4 py-3 font-medium">Nguồn</th><th className="px-4 py-3 font-medium">AI xử lý</th><th className="px-4 py-3 font-medium">Tiến độ</th><th className="px-4 py-3 font-medium">Trạng thái</th><th className="px-5 py-3 text-right font-medium">Thao tác</th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {filteredJobs.map(job => {
                  const provider = getProviderPresentation(job.settings.provider);
                  const status = getStatusPresentation(job.status);
                  const progress = getJobProgress(job);
                  return (
                    <tr key={job.id} className="transition hover:bg-slate-800/30">
                      <td className="max-w-md px-5 py-4"><button type="button" onClick={() => handleOpenJob(job.id)} className="block max-w-full text-left"><span className="block truncate font-medium text-slate-100 hover:text-cyan-300">{getJobSourceTitle(job)}</span><span className="mt-1 block truncate font-mono text-xs text-slate-600">{job.id}</span></button></td>
                      <td className="px-4 py-4 text-slate-400">{getSourceLabel(job.source)}</td>
                      <td className="px-4 py-4"><span className="rounded-md border border-violet-900/70 bg-violet-950/40 px-2 py-1 text-xs font-medium text-violet-200">{provider.label}</span></td>
                      <td className="px-4 py-4"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-500" style={{ width: `${(progress.completed / progress.total) * 100}%` }} /></div><span className="text-xs tabular-nums text-slate-500">{progress.completed}/{progress.total}</span></div></td>
                      <td className="px-4 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.badgeClassName}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} />{status.label}</span></td>
                      <td className="px-5 py-4"><div className="flex justify-end gap-2">{canRetryJob(job) && <button type="button" disabled={isBusy} onClick={() => void perform(() => client.retry(storeId, job.id), `Đã đưa “${getJobSourceTitle(job)}” vào xử lý lại.`)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-950/60 disabled:opacity-50">Thử lại</button>}<button type="button" onClick={() => handleOpenJob(job.id)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-cyan-300 transition hover:bg-cyan-950/60">Xem chi tiết</button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-16 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-xl" aria-hidden="true">⌕</div><h3 className="mt-4 font-medium text-slate-200">{totalCount === 0 ? "Chưa có sản phẩm trong hàng đợi" : "Không tìm thấy sản phẩm phù hợp"}</h3><p className="mt-1 text-sm text-slate-500">{totalCount === 0 ? "Sản phẩm từ Auto SEO hoặc nguồn nhập sẽ xuất hiện tại đây." : "Hãy thử xóa từ khóa hoặc thay đổi bộ lọc."}</p>{totalCount > 0 && <button type="button" className="mt-4 text-sm font-medium text-cyan-300 hover:text-cyan-200" onClick={() => { setOffset(0); setQuery(""); setStatusGroup("all"); setProviderFilter("all"); }}>Xóa bộ lọc</button>}</div>
        )}

        {queue && queue.jobs.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3 text-xs text-slate-500"><span>Trang {Math.floor(offset / 50) + 1} · hiển thị {filteredJobs.length}/{queue.jobs.length} sản phẩm trên trang</span><div className="flex gap-2"><button type="button" disabled={offset === 0 || isBusy} onClick={() => setOffset(current => Math.max(0, current - 50))} className={SECONDARY_BUTTON_CLASS_NAME}>Trang trước</button><button type="button" disabled={queue.nextOffset === null || isBusy} onClick={() => setOffset(queue.nextOffset ?? offset)} className={SECONDARY_BUTTON_CLASS_NAME}>Trang sau</button></div></div>
        )}
      </section>

      <details className="group rounded-2xl border border-slate-800 bg-slate-900/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4"><div><h2 className="font-medium text-slate-200">Cấu hình xử lý</h2><p className="mt-1 text-xs text-slate-500">{settings ? `${getProviderPresentation(settings.provider).label} · ${settings.batchSize} sản phẩm/lượt · ${settings.language}` : "Đang tải cấu hình…"}</p></div><span className="text-slate-500 transition group-open:rotate-180" aria-hidden="true">⌄</span></summary>
        {settings && (
          <form className="grid gap-5 border-t border-slate-800 px-5 py-5 lg:grid-cols-2" onSubmit={event => { event.preventDefault(); void perform(() => client.configure(storeId, settings), "Đã lưu cấu hình xử lý SEO."); }}>
            <label className="space-y-2"><span className="block text-sm font-medium text-slate-300">AI xử lý</span><select className={`${FIELD_CLASS_NAME} w-full`} value={settings.provider} onChange={event => handleProviderChange(event.target.value)}><option value="gemini">Gemini — tự động qua API</option><option value="custom_gpt">GPT Custom — xử lý thủ công</option><option value="codex_mcp">Codex MCP — xử lý thủ công</option></select><span className="block text-xs text-slate-500">Chỉ áp dụng cho sản phẩm mới; sản phẩm đang chạy giữ nguyên AI hiện tại.</span></label>
            <div className="grid grid-cols-2 gap-3"><label className="space-y-2"><span className="block text-sm font-medium text-slate-300">Số sản phẩm mỗi lượt</span><input className={`${FIELD_CLASS_NAME} w-full`} type="number" min={1} max={10} value={settings.batchSize} onChange={event => setSettings({ ...settings, batchSize: Number(event.target.value) })} /></label><label className="space-y-2"><span className="block text-sm font-medium text-slate-300">Ngôn ngữ đầu ra</span><input className={`${FIELD_CLASS_NAME} w-full`} value={settings.language} onChange={event => setSettings({ ...settings, language: event.target.value })} /></label></div>
            <label className="space-y-2 lg:col-span-2"><span className="block text-sm font-medium text-slate-300">Quy tắc nội dung</span><textarea className={`${FIELD_CLASS_NAME} min-h-24 w-full resize-y`} value={settings.instructions} onChange={event => setSettings({ ...settings, instructions: event.target.value })} /></label>
            <div className="lg:col-span-2"><button type="submit" disabled={isBusy} className={PRIMARY_BUTTON_CLASS_NAME}>Lưu cấu hình</button></div>
          </form>
        )}
      </details>

      {selectedJobId && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="job-detail-title">
          <button type="button" aria-label="Đóng chi tiết sản phẩm" onClick={() => setSelectedJobId(null)} className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" />
          <aside className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l border-slate-800 bg-slate-950 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-5 py-4 backdrop-blur"><div><p className="text-xs font-medium uppercase tracking-wide text-cyan-400">Chi tiết sản phẩm</p><h2 id="job-detail-title" className="mt-1 max-w-lg truncate font-semibold text-white">{selectedJob ? getJobSourceTitle(selectedJob) : "Đang tải…"}</h2></div><button type="button" aria-label="Đóng" onClick={() => setSelectedJobId(null)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white">✕</button></div>
            {selectedJob ? <JobDetail client={client} job={selectedJob} storeId={storeId} isBusy={isBusy} canTransfer={canTransferSelectedJob} perform={perform} /> : <div className="space-y-3 p-5" aria-label="Đang tải chi tiết sản phẩm">{[1, 2, 3, 4].map(row => <div key={row} className="h-20 animate-pulse rounded-xl bg-slate-900" />)}</div>}
          </aside>
        </div>
      )}
    </section>
  );
}

interface JobDetailProps {
  readonly client: CustomGptClient;
  readonly job: GptSeoJob;
  readonly storeId: string;
  readonly isBusy: boolean;
  readonly canTransfer: boolean;
  readonly perform: (operation: () => Promise<unknown>, successMessage: string) => Promise<void>;
}

function JobDetail({ client, job, storeId, isBusy, canTransfer, perform }: JobDetailProps): React.JSX.Element {
  const status = getStatusPresentation(job.status);
  const stages = [
    { key: "analysis", label: "Phân tích" },
    { key: "research", label: "Nghiên cứu" },
    { key: "keywords", label: "Từ khóa" },
    { key: "submission", label: "Kết quả" },
  ] as const;

  return (
    <div className="space-y-6 p-5">
      <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.badgeClassName}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} />{status.label}</span><span className="rounded-md border border-violet-900/70 bg-violet-950/40 px-2 py-1 text-xs text-violet-200">{getProviderPresentation(job.settings.provider).label}</span><span className="font-mono text-xs text-slate-600">{job.id}</span></div>
      {job.error && <div className="rounded-xl border border-rose-900 bg-rose-950/30 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-rose-400">Lỗi gần nhất</p><p className="mt-2 text-sm leading-6 text-rose-200">{job.error}</p></div>}
      <section aria-labelledby="job-progress-title"><h3 id="job-progress-title" className="text-sm font-semibold text-slate-200">Tiến độ xử lý</h3><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{stages.map((stage, index) => { const isComplete = stage.key in job.checkpoints || job.status === "REVIEW_READY"; return <div key={stage.key} className={`rounded-lg border p-3 ${isComplete ? "border-emerald-900 bg-emerald-950/30" : "border-slate-800 bg-slate-900"}`}><span className={`text-xs ${isComplete ? "text-emerald-300" : "text-slate-500"}`}>{isComplete ? "✓" : index + 1} {stage.label}</span></div>; })}</div></section>
      <section aria-labelledby="job-images-title"><div className="flex items-center justify-between gap-3"><h3 id="job-images-title" className="text-sm font-semibold text-slate-200">Ảnh sản phẩm ({job.input.images.length})</h3><span className="text-xs text-slate-500">Bấm ảnh để mở kích thước đầy đủ</span></div>{job.input.images.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{job.input.images.map((image, index) => <a key={image.id} href={image.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><img src={image.url} alt={`Ảnh sản phẩm ${index + 1}`} loading="lazy" className="h-36 w-full object-contain p-2 transition group-hover:scale-[1.02]" /><span className="block truncate border-t border-slate-800 px-2 py-1.5 font-mono text-[10px] text-slate-600">{job.id}/{image.id}</span></a>)}</div> : <p className="mt-3 rounded-lg bg-slate-900 p-4 text-sm text-slate-500">Sản phẩm này chưa có ảnh.</p>}</section>
      {canTransfer && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" aria-labelledby="transfer-provider-title"><h3 id="transfer-provider-title" className="text-sm font-semibold text-slate-200">Đổi AI xử lý cho sản phẩm này</h3><p className="mt-1 text-xs leading-5 text-slate-500">Nếu sản phẩm đang nằm trong một batch, hãy thu hồi batch trước khi chuyển.</p><div className="mt-3 flex flex-wrap gap-2">{(["gemini", "custom_gpt", "codex_mcp"] as const).map((provider: SeoProvider) => <button key={provider} type="button" disabled={isBusy || job.settings.provider === provider} onClick={() => void perform(() => client.transfer(storeId, job.id, provider), `Đã chuyển sang ${getProviderPresentation(provider).label}.`)} className={SECONDARY_BUTTON_CLASS_NAME}>{getProviderPresentation(provider).label}</button>)}</div></section>}
      <details className="rounded-xl border border-slate-800 bg-slate-900/40"><summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-300">Dữ liệu checkpoint và kết quả</summary><pre className="max-h-96 overflow-auto border-t border-slate-800 p-4 text-xs leading-5 text-slate-400">{JSON.stringify({ checkpoints: job.checkpoints, result: job.result }, null, 2)}</pre></details>
      <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-5">{canRetryJob(job) && <button type="button" disabled={isBusy} onClick={() => void perform(() => client.retry(storeId, job.id), "Đã đưa sản phẩm vào xử lý lại.")} className={SECONDARY_BUTTON_CLASS_NAME}>Thử lại</button>}<Link className={PRIMARY_BUTTON_CLASS_NAME} to={`/seo-review?storeId=${encodeURIComponent(storeId)}`}>Mở trong SEO Review →</Link></div>
    </div>
  );
}
