import type { GptSeoJob } from "../../types";
import { canRetryJob, getJobIdentityLabel, getJobIssueSummary, getJobProgressPresentation, getJobSourceTitle, getProviderPresentation } from "../seo-queue-view-model";
import { CopyJobIdButton } from "./CopyJobIdButton";
import { QueueProductImage } from "./QueueProductImage";
import { QueueStatusBadge } from "./QueueStatusBadge";

interface QueueJobsTableProps {
  readonly jobs: readonly GptSeoJob[];
  readonly isBusy: boolean;
  readonly onOpenJob: (jobId: string) => void;
  readonly onRetryJob: (job: GptSeoJob) => void;
}

export function QueueJobsTable({ jobs, isBusy, onOpenJob, onRetryJob }: QueueJobsTableProps): React.JSX.Element {
  return <div role="region" aria-label="Danh sách sản phẩm SEO có thể cuộn" tabIndex={0} className="max-h-[max(360px,calc(100dvh-420px))] overflow-auto">
    <table className="w-full min-w-[940px] table-fixed text-left text-sm">
      <caption className="sr-only">Sản phẩm, checkpoint đã lưu, trạng thái và thao tác xử lý SEO</caption>
      <colgroup><col className="w-[39%]" /><col className="w-[22%]" /><col className="w-[25%]" /><col className="w-[14%]" /></colgroup>
      <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        <tr><th scope="col" className="px-5 py-3 font-medium">Sản phẩm / Nguồn</th><th scope="col" className="px-4 py-3 font-medium">Tiến độ đã ghi nhận</th><th scope="col" className="px-4 py-3 font-medium">Trạng thái / Cần xử lý</th><th scope="col" className="px-4 py-3 text-right font-medium">Thao tác</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {jobs.map(job => {
          const progress = getJobProgressPresentation(job, false);
          const issue = getJobIssueSummary(job);
          const title = getJobSourceTitle(job);
          return <tr key={job.id} className="align-top transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/60">
            <td className="px-5 py-4"><div className="flex items-start gap-3">
              <QueueProductImage url={job.input.images[0]?.url} />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onOpenJob(job.id)} title={title} className="line-clamp-2 text-left font-medium leading-5 text-slate-900 hover:text-blue-700 dark:text-slate-100 dark:hover:text-blue-300">{title}</button>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400" title={getJobIdentityLabel(job)}>{getJobIdentityLabel(job)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400"><span>{job.source === "auto_seo" ? "Auto SEO" : "Amazon"}</span><span aria-hidden="true">·</span><span>{getProviderPresentation(job.settings.provider).label}</span><CopyJobIdButton key={job.id} jobId={job.id} /></div>
              </div>
            </div></td>
            <td className="px-4 py-4"><p className="text-xs font-medium leading-5 text-slate-700 dark:text-slate-300">{progress.label}</p>
              {progress.completed !== null && <div aria-hidden="true" className="mt-2 flex max-w-36 gap-1">{[1, 2, 3, 4].map(step => <span key={step} className={`h-1 flex-1 rounded-full ${step <= (progress.completed ?? 0) ? "bg-blue-600 dark:bg-blue-400" : "bg-slate-200 dark:bg-slate-700"}`} />)}</div>}
              <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{progress.detail}</p>
            </td>
            <td className="px-4 py-4"><QueueStatusBadge status={job.status} />{issue && <p className="mt-2 max-w-72 text-xs leading-5 text-amber-800 dark:text-amber-300">{issue}</p>}</td>
            <td className="px-4 py-4"><div className="flex flex-col items-end gap-2">
              {canRetryJob(job) && <button type="button" disabled={isBusy} onClick={() => onRetryJob(job)} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950">Thử lại</button>}
              <button type="button" onClick={() => onOpenJob(job.id)} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/60">Xem chi tiết</button>
            </div></td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
