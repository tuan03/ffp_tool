import { isReviewSynced, reviewStage } from "../review-actions";
import type { SeoProductUiViewModel } from "../types";

import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { SourceOriginBadge } from "./SourceOriginBadge";

export function ReviewResultStatus({ product, currentStoreId }: {
  readonly product: SeoProductUiViewModel;
  readonly currentStoreId?: string;
}): React.JSX.Element {
  const stage = reviewStage(product);
  const syncedAt = product.shopifySyncedAt ?? product.lastSyncedAt;
  const publication = product.salesChannelPublication;
  const hasPartialPublication = product.shopifySyncError?.startsWith("SHOPIFY_PUBLICATION_INCOMPLETE:") || publication?.status === "partial";
  return <section aria-label="Trạng thái bản ghi SEO" className="space-y-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
    <div className="flex flex-wrap items-center gap-2">
      <ReviewStatusBadge product={product} />
      <SourceOriginBadge product={product} showStatusHint={false} />
      <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">Đích: {product.storeId || currentStoreId || "Chưa xác định"}</span>
    </div>
    <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span>{isReviewSynced(product) && syncedAt ? `Sync lúc ${new Date(syncedAt).toLocaleString("vi-VN")}` : `Cập nhật ${new Date(product.updatedAt).toLocaleString("vi-VN")}`}</span>
      {product.seoVersion !== undefined && product.seoVersion > 0 && <span>Phiên bản SEO {product.seoVersion}</span>}
    </div>
    {hasPartialPublication ? <p className="rounded-md bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">Nội dung đã sync; một số kênh bán hàng chưa được bật. Kiểm tra kênh trước khi gửi lại nội dung.</p>
      : stage === "failed" ? <p className="rounded-md bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">Đồng bộ cần được kiểm tra. Xem thông tin tác vụ trước khi thử lại để tránh ghi trùng.</p>
      : stage === "syncing" ? <p className="text-xs leading-5 text-blue-700 dark:text-blue-300">{product.backendPublish || product.coordinatorReview
        ? "Tác vụ đồng bộ đang được xử lý trên server. Không cần giữ tab này mở hoặc gửi lại."
        : "Đang đồng bộ; đợi tác vụ hoàn tất trước khi thao tác tiếp."}</p> : null}
    {publication && <details className="text-xs text-slate-600 dark:text-slate-400">
      <summary className="cursor-pointer">Kênh bán hàng: {publication.channels.length ? `${publication.channels.filter(channel => channel.published).length}/${publication.channels.length} đã bật` : "Chưa có danh sách"}</summary>
      <ul className="mt-2 space-y-1">{publication.channels.map(channel => <li key={channel.id}>{channel.name} · {channel.published ? "Đã bật" : "Chưa bật"}</li>)}</ul>
    </details>}
  </section>;
}
