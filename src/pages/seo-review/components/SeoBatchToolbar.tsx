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
  const button = "rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";
  const stages = [
    { value: "pending", label: "Chờ duyệt" }, { value: "ready", label: "Chờ sync" },
    { value: "syncing", label: "Đang sync" }, { value: "failed", label: "Cần kiểm tra" },
  ] as const;
  return <section aria-label="Bộ lọc SEO Review" className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={workspace === "work"} onClick={() => props.onWorkspaceChange("work")}
        className={button + (workspace === "work" ? " border-cyan-500 bg-cyan-950 text-cyan-200" : " border-slate-700 text-slate-300")}>Cần xử lý ({workCount})</button>
      <button type="button" aria-pressed={workspace === "history"} onClick={() => props.onWorkspaceChange("history")}
        className={button + (workspace === "history" ? " border-teal-500 bg-teal-950 text-teal-200" : " border-slate-700 text-slate-300")}>Lịch sử ({counts.history})</button>
      <span className="ml-auto text-xs text-slate-500">Số trạng thái tính trên toàn store / nguồn đang chọn</span>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="min-w-48 flex-1 text-xs text-slate-400">Tìm sản phẩm
        <input aria-label="Tìm sản phẩm Review" value={filter.searchQuery} onChange={event => props.onFilterChange({ searchQuery: event.target.value })}
          placeholder="Tên, handle hoặc ASIN…" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
      </label>
      <label className="text-xs text-slate-400">Nguồn
        <select aria-label="Nguồn Review" value={filter.sourceOriginFilter ?? "all"}
          onChange={event => props.onFilterChange({ sourceOriginFilter: event.target.value as SeoReviewFilterState["sourceOriginFilter"] })}
          className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
          <option value="all">Tất cả nguồn</option><option value="distributed_crawler">Crawler</option>
          <option value="auto_seo">Auto SEO</option><option value="pinterest_pod">Pinterest POD</option>
        </select>
      </label>
      <label className="text-xs text-slate-400">Hiển thị
        <select aria-label="Kiểu hiển thị Review" value={viewMode} onChange={event => props.onViewModeChange(event.target.value as SeoReviewViewMode)}
          className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
          <option value="cards">Thẻ</option><option value="table">Danh sách</option><option value="split">Xem & duyệt</option>
        </select>
      </label>
    </div>
    {workspace === "work" && <div className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={!filter.stageFilter || filter.stageFilter === "all"} onClick={() => props.onFilterChange({ stageFilter: "all" })}
        className={button + " border-slate-700 text-slate-200"}>Tất cả cần xử lý ({workCount})</button>
      {stages.map(stage => <button key={stage.value} type="button" aria-pressed={filter.stageFilter === stage.value}
        onClick={() => props.onFilterChange({ stageFilter: stage.value })}
        className={button + (filter.stageFilter === stage.value ? " border-cyan-500 text-cyan-200" : " border-slate-700 text-slate-400")}>
        {stage.label} ({counts[stage.value]})</button>)}
    </div>}
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
      <button type="button" onClick={props.onSelectAll} className={button + " border-slate-700 text-slate-300"}>Chọn trang này</button>
      {selectedCount > 0 && <>
        <span className="text-xs text-slate-400">Đã chọn {selectedCount}</span>
        <button type="button" onClick={props.onClearSelection} className="px-2 text-xs text-slate-400">Bỏ chọn</button>
        {props.approvableCount > 0 && <button type="button" disabled={isBusy} onClick={props.onApproveSelected}
          className={button + " border-emerald-700 bg-emerald-950 text-emerald-200"}>Duyệt đã chọn ({props.approvableCount})</button>}
        {props.syncableCount > 0 && <button type="button" disabled={isBusy} onClick={props.onSyncSelected}
          className={button + " border-cyan-600 bg-cyan-700 text-white"}>Sync đã chọn ({props.syncableCount})</button>}
        {props.archivableCount > 0 && <button type="button" disabled={isBusy} onClick={props.onArchiveSelected}
          className={button + " border-slate-600 text-slate-300"}>Lưu trữ đã chọn ({props.archivableCount})</button>}
      </>}
    </div>
  </section>;
}
