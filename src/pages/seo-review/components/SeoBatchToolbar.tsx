import type { SeoReviewCounts, SeoReviewWorkspace } from "../../../shared/seo-review-list";
import type { SeoReviewFilterState, SeoReviewViewMode } from "../types";

export interface SeoBatchToolbarProps {
  readonly counts: SeoReviewCounts;
  readonly workspace: SeoReviewWorkspace;
  readonly filter: SeoReviewFilterState;
  readonly viewMode: SeoReviewViewMode;
  readonly selectedCount: number;
  readonly approvableCount: number;
  readonly syncableCount: number;
  readonly archivableCount: number;
  readonly isBusy: boolean;
  readonly onWorkspaceChange: (workspace: SeoReviewWorkspace) => void;
  readonly onFilterChange: (filter: Partial<SeoReviewFilterState>) => void;
  readonly onViewModeChange: (mode: SeoReviewViewMode) => void;
  readonly onSelectAll: () => void;
  readonly onClearSelection: () => void;
  readonly onApproveSelected: () => void;
  readonly onSyncSelected: () => void;
  readonly onArchiveSelected: () => void;
}

export function SeoBatchToolbar(props: SeoBatchToolbarProps): React.JSX.Element {
  const { counts, workspace, filter, viewMode, selectedCount, isBusy } = props;
  const workCount = counts.pending + counts.ready + counts.syncing + counts.failed;
  const button = "rounded-lg px-3 py-2 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40";
  const options = [
    { label: `Tất cả (${workCount + counts.history})`, workspace: "all", stage: "all", count: workCount + counts.history },
    { label: `Đã sync (${counts.synced ?? 0})`, workspace: "synced", stage: "all", count: counts.synced ?? 0 },
    { label: `Đang sync (${counts.syncing})`, workspace: "work", stage: "syncing", count: counts.syncing },
    { label: `Cần kiểm tra (${counts.failed})`, workspace: "work", stage: "failed", count: counts.failed },
    { label: `Cần xử lý (${workCount})`, workspace: "work", stage: "all", count: workCount },
  ] as const;
  return <section aria-label="Bộ lọc SEO Review" className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
      {options.map(option => <button key={option.label} type="button"
        aria-pressed={workspace === option.workspace && (filter.stageFilter ?? "all") === option.stage}
        onClick={() => { props.onWorkspaceChange(option.workspace); props.onFilterChange({ stageFilter: option.stage }); }}
        className={button + (workspace === option.workspace && (filter.stageFilter ?? "all") === option.stage
          ? " bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
          : " text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100")}>{option.label}</button>)}
      <span className="ml-auto px-2 text-[11px] text-slate-400">Toàn store / nguồn đang chọn</span>
    </div>
    <div className="flex items-end gap-3 p-3">
      <label className="min-w-48 flex-1 text-xs font-medium text-slate-500 dark:text-slate-400">Tìm sản phẩm
        <input aria-label="Tìm sản phẩm Review" value={filter.searchQuery} onChange={event => props.onFilterChange({ searchQuery: event.target.value })}
          placeholder="Tên sản phẩm, handle hoặc ASIN…" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-2 focus:outline-blue-600/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100" />
      </label>
      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Nguồn
        <select aria-label="Nguồn Review" value={filter.sourceOriginFilter ?? "all"}
          onChange={event => props.onFilterChange({ sourceOriginFilter: event.target.value as SeoReviewFilterState["sourceOriginFilter"] })}
          className="mt-1.5 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <option value="all">Tất cả nguồn</option><option value="distributed_crawler">Crawler</option>
          <option value="auto_seo">Auto SEO</option><option value="pinterest_pod">Pinterest POD</option>
        </select>
      </label>
      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Hiển thị
        <select aria-label="Kiểu hiển thị Review" value={viewMode} onChange={event => props.onViewModeChange(event.target.value as SeoReviewViewMode)}
          className="mt-1.5 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <option value="cards">Thẻ</option><option value="table">Danh sách</option><option value="split">Danh sách & nội dung</option>
        </select>
      </label>
      <button type="button" onClick={props.onSelectAll} className={button + " border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"}>Chọn trang này</button>
    </div>
    {selectedCount > 0 && <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/50">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Đã chọn {selectedCount} trên trang này</span>
      <button type="button" onClick={props.onClearSelection} className="text-xs text-blue-700 hover:underline dark:text-blue-300">Bỏ chọn</button>
      {props.archivableCount > 0 && <button type="button" disabled={isBusy} onClick={props.onArchiveSelected}
        className={button + " ml-auto text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"}>Lưu trữ đã chọn ({props.archivableCount})</button>}
      {props.syncableCount > 0 && <details className="text-xs text-slate-500 dark:text-slate-400">
        <summary className="cursor-pointer py-2">Thao tác ngoại lệ</summary>
        <p className="py-2">Chỉ dùng cho bản ghi cần xử lý thủ công; tác vụ tự Sync không cần thao tác này.</p>
        <button type="button" disabled={isBusy} onClick={props.onSyncSelected} className={button + " border border-slate-200 dark:border-slate-700"}>Sync đã chọn ({props.syncableCount})</button>
      </details>}
    </div>}
  </section>;
}
