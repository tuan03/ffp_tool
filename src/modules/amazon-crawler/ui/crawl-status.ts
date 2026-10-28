import type { AmazonCrawlerProgress, AmazonCrawlerSeoQueueHandoffSummary } from "../types";

export interface CrawlStatus {
  readonly title: string;
  readonly detail: string;
  readonly tone: "working" | "success" | "warning" | "error" | "idle";
}

export function resolveCrawlStatus(input: {
  readonly isChecking: boolean;
  readonly isRunning: boolean;
  readonly isStale: boolean;
  readonly progress?: AmazonCrawlerProgress | null;
  readonly executionState?: string;
  readonly cancelled?: boolean;
  readonly cancelling?: boolean;
  readonly blockers: readonly string[];
  readonly errors: readonly string[];
  readonly summary: AmazonCrawlerSeoQueueHandoffSummary;
  readonly completion?: { readonly label: string; readonly tone: "success" | "warning" } | null;
}): CrawlStatus {
  const summary = input.summary;
  const batch = input.progress?.batch;
  const counts = [batch && input.progress ? `Đã xử lý ${input.progress.completed}/${input.progress.total} link` : null,
    batch ? `${batch.skippedShopify} link đã có Shopify · ${batch.skippedPipeline} link đang trong Queue/Review · ${batch.covered} link lấy qua link khác` : null,
    batch?.attention ? `${batch.attention} link cần kiểm tra` : null,
    summary.totalProducts > 0 ? `Đã bàn giao ${summary.handedOver}/${summary.totalProducts} sản phẩm` : `Bàn giao mới: 0 sản phẩm`,
    summary.pending > 0 ? `${summary.pending} đang chuẩn bị` : null,
    summary.notHandedOver > 0 ? `${summary.notHandedOver} chưa bàn giao` : null,
    summary.skippedExistingShopify ? `${summary.skippedExistingShopify} sản phẩm bỏ qua: đã có Shopify` : null,
    summary.skippedExistingPipeline ? `${summary.skippedExistingPipeline} sản phẩm bỏ qua: đã có trong Queue/Review` : null,
  ].filter(Boolean).join(" · ");
  if (input.isChecking && !input.isRunning) return { title: "Đang kiểm tra ASIN", detail: "Kiểm tra Shopify và SEO Queue trước khi tạo phiên mới…", tone: "working" };
  if (input.errors.length) return { title: input.isRunning ? "Phiên đang chạy có lỗi cần kiểm tra" : "Có lỗi cần kiểm tra", detail: counts || "Kết quả đã nhận được giữ nguyên. Mở Xem lỗi để biết bước cần xử lý.", tone: "error" };
  if (input.isStale) return { title: "Chưa xác minh được trạng thái mới", detail: "Đang kết nối lại; số liệu hiện tại là lần xác nhận gần nhất. Không có nghĩa phiên đã thất bại.", tone: "warning" };
  if (input.cancelled) return { title: "Phiên đã hủy", detail: counts || "Dữ liệu server đã nhận được giữ nguyên.", tone: "warning" };
  if (input.cancelling) return { title: "Đang hủy phiên an toàn", detail: counts || "Đang chờ server xác nhận dừng; không đóng Agent lúc này.", tone: "warning" };
  if (input.executionState === "paused" || input.executionState === "pausing") return { title: input.executionState === "paused" ? "Tạm dừng nhận ASIN mới" : "Đang tạm dừng an toàn", detail: counts || "Task đang chạy được xử lý theo trạng thái server.", tone: "warning" };
  if (summary.pending > 0 && summary.workerStatus === "unavailable") return {
    title: "Tiến trình bàn giao SEO đang gián đoạn",
    detail: `${counts}. Dữ liệu đã nhận được giữ nguyên, không cần cào lại. Cần kiểm tra worker bàn giao trên server.`, tone: "warning",
  };
  if (summary.pending > 0 && summary.workerStatus === "starting") return {
    title: "Đang khởi động tiến trình bàn giao SEO", detail: `${counts}. Dữ liệu đã nhận được giữ nguyên.`, tone: "working",
  };
  if (input.isRunning) {
    const progress = input.progress;
    if (progress?.phase === "captcha") return { title: "Cần xử lý CAPTCHA trên Agent", detail: counts || "Mở Agent để kiểm tra yêu cầu từ Amazon.", tone: "warning" };
    const crawled = progress && progress.total > 0 && progress.completed >= progress.total;
    return { title: crawled ? "Đã cào xong link · Đang nhận dữ liệu và bàn giao SEO Queue" : progress?.phase === "queued" ? "Đang chờ Agent nhận việc" : batch ? "Đang cào lô tự động · Mỗi lần một link" : "Đang cào sản phẩm",
      detail: [progress && !batch ? `${progress.completed}/${progress.total} link` : null, counts, progress?.currentAsin].filter(Boolean).join(" · ") || "Đang chờ số liệu từ server…", tone: "working" };
  }
  if (batch && input.progress && input.progress.completed >= input.progress.total) return {
    title: summary.pending > 0 ? "Đã xử lý danh sách · Đang bàn giao SEO Queue" : batch.attention || summary.notHandedOver > 0 ? "Lô đã kết thúc · Có mục cần kiểm tra" : "Đã xử lý xong danh sách",
    detail: counts, tone: summary.pending > 0 ? "working" : batch.attention || summary.notHandedOver > 0 ? "warning" : "success",
  };
  if (input.completion && summary.pending > 0) return { title: "Đã nhận dữ liệu · Đang bàn giao SEO Queue", detail: input.completion.label, tone: "working" };
  if (input.completion) return { title: input.completion.tone === "success" ? "Phiên cào đã hoàn tất" : "Phiên kết thúc · Còn sản phẩm chưa bàn giao", detail: input.completion.label, tone: input.completion.tone };
  if (input.blockers.length) return { title: "Chưa thể bắt đầu cào", detail: input.blockers.join(" "), tone: "warning" };
  return { title: "Sẵn sàng cào", detail: "Hệ thống sẽ kiểm tra ASIN trước khi tạo phiên.", tone: "idle" };
}
