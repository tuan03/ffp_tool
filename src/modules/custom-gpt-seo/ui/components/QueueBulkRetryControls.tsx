import type { QueueRetryRun } from "../queue-bulk-retry";
import { QUEUE_SECONDARY_BUTTON_CLASS_NAME as BUTTON } from "../queue-styles";

interface QueueBulkRetryControlsProps {
  readonly selectedCount: number;
  readonly totalCount?: number;
  readonly isDisabled: boolean;
  readonly hasPageSearch: boolean;
  readonly isRunning: boolean;
  readonly run: QueueRetryRun | null;
  readonly error: string | null;
  readonly onSelected: () => void;
  readonly onAll: () => void;
  readonly onResume: () => void;
  readonly onStop: () => void;
}

export function QueueBulkRetryControls(props: QueueBulkRetryControlsProps): React.JSX.Element {
  const outcomes = props.run?.outcomes ?? [];
  const total = props.run?.jobIds.length ?? 0;
  const remaining = total - outcomes.length;
  const failed = outcomes.filter(outcome => outcome.status === "failed");
  return <div className="space-y-3 border-b border-slate-200 bg-blue-50/40 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/40">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={BUTTON} disabled={props.isDisabled || props.isRunning || props.selectedCount === 0} onClick={props.onSelected}>Thử lại đã chọn ({props.selectedCount})</button>
      <button type="button" className={BUTTON} disabled={props.isDisabled || props.isRunning || props.hasPageSearch || props.totalCount === 0} onClick={props.onAll}>Thử lại tất cả theo bộ lọc{props.totalCount === undefined ? "" : ` (${props.totalCount})`}</button>
      {props.isRunning && <button type="button" className={BUTTON} onClick={props.onStop}>Dừng sau nhóm hiện tại</button>}
      {!props.isRunning && props.run && remaining > 0 && <button type="button" className={BUTTON} disabled={props.isDisabled} onClick={props.onResume}>Tiếp tục {remaining} còn lại</button>}
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-400">{props.hasPageSearch ? "Từ khóa chỉ tìm trong trang này. Xóa từ khóa để thử lại tất cả các trang, hoặc chọn các dòng đang hiển thị." : "Tất cả theo bộ lọc áp dụng cho store và AI đang chọn, gồm các trang sau. Sản phẩm đã đổi trạng thái sẽ được bỏ qua."}</p>
    {(props.isRunning || props.run) && <div role="status" aria-live="polite" className="text-sm text-blue-800 dark:text-blue-200">
      {props.isRunning ? props.run ? "Đang thử lại" : "Đang lấy danh sách" : remaining ? "Đã dừng" : "Đã xử lý xong"}
      {props.run && <> · {outcomes.length}/{total} · Thành công: {outcomes.filter(outcome => outcome.status === "retried").length} · Bỏ qua: {outcomes.filter(outcome => outcome.status === "skipped").length} · Lỗi: {failed.length} · Còn lại: {remaining}</>}
    </div>}
    {props.error && <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">{props.error} Phần đã xác nhận được giữ nguyên.</p>}
    {failed.length > 0 && <details className="text-xs text-amber-800 dark:text-amber-300"><summary>Xem {failed.length} sản phẩm chưa thử lại được</summary><ul>{failed.map(outcome => <li key={outcome.jobId}>{outcome.jobId}</li>)}</ul></details>}
  </div>;
}
