import { Link } from "react-router-dom";

import { AppIcon } from "../../../../shared/components/AppIcon";

import type { GptSeoJob, SeoProvider } from "../../types";
import { canRetryJob, getJobIdentityLabel, getJobIssueSummary, getJobProgressPresentation, getProviderPresentation } from "../seo-queue-view-model";
import { QUEUE_PRIMARY_BUTTON_CLASS_NAME, QUEUE_SECONDARY_BUTTON_CLASS_NAME } from "../queue-styles";
import { CopyJobIdButton } from "./CopyJobIdButton";
import { QueueStatusBadge } from "./QueueStatusBadge";

interface QueueJobDetailProps {
  readonly job: GptSeoJob;
  readonly storeId: string;
  readonly isBusy: boolean;
  readonly canTransfer: boolean;
  readonly onRetry: () => void;
  readonly onTransfer: (provider: SeoProvider) => void;
}

export function QueueJobDetail({ job, storeId, isBusy, canTransfer, onRetry, onTransfer }: QueueJobDetailProps): React.JSX.Element {
  const issue = getJobIssueSummary(job);
  const progress = getJobProgressPresentation(job);
  const stages = [
    { key: "analysis", label: "Phân tích" }, { key: "research", label: "Nghiên cứu" },
    { key: "keywords", label: "Từ khóa" }, { key: "submission", label: "Kết quả" },
  ] as const;
  return <div className="space-y-6 p-6">
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><QueueStatusBadge status={job.status} /><span className="text-xs text-slate-500 dark:text-slate-400">{getProviderPresentation(job.settings.provider).label}</span></div>
      <p className="break-words text-sm font-medium text-slate-700 dark:text-slate-300">{getJobIdentityLabel(job)}</p>
      <CopyJobIdButton key={job.id} jobId={job.id} />
    </div>

    {issue && <section aria-label="Vấn đề cần xử lý" className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/50">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200"><AppIcon name="warning" />Vấn đề cần xử lý</div>
      <p className="mt-2 text-sm leading-6 text-amber-900 dark:text-amber-200">{issue}</p>
      <p className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-300">Thử lại sẽ đưa sản phẩm về hàng đợi; không tự duyệt hoặc đồng bộ lên Shopify.</p>
      {canRetryJob(job) && <button type="button" disabled={isBusy} onClick={onRetry} className={`${QUEUE_SECONDARY_BUTTON_CLASS_NAME} mt-3`}><AppIcon name="refresh" />Thử lại</button>}
    </section>}

    {job.status === "REVIEW_READY" && <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/50">
      <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Kết quả đã sẵn sàng để bạn duyệt.</p>
      <Link className={`${QUEUE_PRIMARY_BUTTON_CLASS_NAME} mt-3`} to={`/seo-review?storeId=${encodeURIComponent(storeId)}`}>Mở SEO Review của store<AppIcon name="arrow" /></Link>
    </section>}

    <section aria-labelledby="job-progress-title">
      <div className="flex items-center justify-between gap-3"><h3 id="job-progress-title" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tiến độ xử lý</h3><span className="text-xs text-slate-500 dark:text-slate-400">{stages.filter(stage => Object.hasOwn(job.checkpoints, stage.key)).length}/4 checkpoint</span></div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{progress.label}</p>
      <ol className="mt-3 grid grid-cols-4 gap-2">{stages.map((stage, index) => {
        const isComplete = Object.hasOwn(job.checkpoints, stage.key);
        return <li key={stage.key} className={`rounded-lg border p-3 ${isComplete ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"}`}>
          <span className={`flex items-center gap-1.5 text-xs font-medium ${isComplete ? "text-emerald-800 dark:text-emerald-300" : "text-slate-600 dark:text-slate-400"}`}>{isComplete ? <AppIcon name="check" className="h-3.5 w-3.5" /> : <span>{index + 1}.</span>}<span>{stage.label}</span></span>
          <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{isComplete ? "Đã có checkpoint" : "Chưa có checkpoint"}</span>
        </li>;
      })}</ol>
      <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">Các bước phản ánh checkpoint đã lưu, không phải phần trăm thời gian còn lại.</p>
    </section>

    <dl className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 p-4 text-xs dark:border-slate-700">
      <div><dt className="text-slate-500 dark:text-slate-400">Đưa vào hàng đợi</dt><dd className="mt-1 text-slate-800 dark:text-slate-200">{new Date(job.createdAt).toLocaleString("vi-VN")}</dd></div>
      <div><dt className="text-slate-500 dark:text-slate-400">Cập nhật gần nhất</dt><dd className="mt-1 text-slate-800 dark:text-slate-200">{new Date(job.updatedAt).toLocaleString("vi-VN")}</dd></div>
    </dl>

    {canTransfer && <details className="rounded-lg border border-slate-200 dark:border-slate-700">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">Đổi AI xử lý</summary>
      <div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-700"><p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Nếu sản phẩm đang nằm trong một batch, hãy thu hồi batch trong “Máy & phiên chạy” trước khi chuyển.</p>
        <div className="flex flex-wrap gap-2">{(["gemini", "custom_gpt", "codex_mcp"] as const).map(provider => <button key={provider} type="button" disabled={isBusy || job.settings.provider === provider} onClick={() => onTransfer(provider)} className={QUEUE_SECONDARY_BUTTON_CLASS_NAME}>{getProviderPresentation(provider).label}</button>)}</div>
      </div>
    </details>}

    <details className="rounded-lg border border-slate-200 dark:border-slate-700">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">Ảnh sản phẩm ({job.input.images.length})</summary>
      {job.input.images.length ? <div className="grid grid-cols-3 gap-3 border-t border-slate-200 p-4 dark:border-slate-700">{job.input.images.map((image, index) => <a key={image.id} href={image.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700"><img src={image.url} alt={`Ảnh sản phẩm ${index + 1}`} loading="lazy" className="h-32 w-full object-contain p-2" /></a>)}</div> : <p className="px-4 pb-4 text-xs text-slate-500 dark:text-slate-400">Sản phẩm này chưa có ảnh.</p>}
    </details>

    <details className="rounded-lg border border-slate-200 dark:border-slate-700"><summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">Dữ liệu kỹ thuật · checkpoint và kết quả</summary><pre className="max-h-96 overflow-auto border-t border-slate-200 p-4 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-400">{JSON.stringify({ checkpoints: job.checkpoints, result: job.result }, null, 2)}</pre></details>
  </div>;
}
