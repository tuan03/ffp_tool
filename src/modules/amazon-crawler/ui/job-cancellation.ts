import type { AmazonCrawlerJobSnapshot, ProductPipelineStatus } from "../types";

const CANCELLATION_PHASE_LABELS: Record<ProductPipelineStatus | "pipeline", string> = {
  received: "chờ pipeline",
  normalizing: "chuẩn hóa dữ liệu",
  seo: "tạo nội dung SEO",
  image_processing: "xử lý ảnh",
  waiting_review: "chờ kiểm duyệt",
  sync_queued: "chờ đồng bộ Shopify",
  syncing: "đồng bộ Shopify",
  shopify_writing: "ghi dữ liệu Shopify",
  stopping_after_write: "hoàn tất lần ghi Shopify đang chạy",
  cancelling: "hủy pipeline",
  retry_wait: "chờ thử lại pipeline",
  completed: "hoàn tất pipeline",
  rejected: "đã từ chối khi kiểm duyệt",
  failed: "xử lý lỗi pipeline",
  reconciliation_required: "đối soát Shopify",
  cancelled: "hủy pipeline",
  pipeline: "pipeline",
};

function parseCoordinatorTimestamp(timestamp: string): number {
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
  return Date.parse(hasExplicitTimezone ? timestamp : `${timestamp}Z`);
}

function formatElapsedTime(requestedAt: string | null, now: number): string {
  if (!requestedAt) return "vừa xong";
  const elapsedSeconds = Math.max(0, Math.floor((now - parseCoordinatorTimestamp(requestedAt)) / 1_000));
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 5) return "vừa xong";
  if (elapsedSeconds < 60) return `${elapsedSeconds} giây trước`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} phút trước`;
  return `${Math.floor(elapsedMinutes / 60)} giờ trước`;
}

export function formatCancellationPhase(phase: ProductPipelineStatus | "pipeline"): string {
  return CANCELLATION_PHASE_LABELS[phase];
}

export function isActiveJobStopping(input: {
  readonly activeJobId: string | null;
  readonly controlledJobId: string | null;
  readonly isCancellationPending: boolean;
}): boolean {
  return input.isCancellationPending
    || (input.controlledJobId !== null && input.controlledJobId === input.activeJobId);
}

export function shouldShowStandaloneJobControlMessage(
  tone: "info" | "success" | "error",
  message: string | null,
): boolean {
  return message !== null && tone !== "info";
}

export function describeJobCancellation(job: AmazonCrawlerJobSnapshot, now = Date.now()): string | null {
  if (job.status === "cancelled") {
    return job.completedAt
      ? `Đã dừng hoàn tất lúc ${new Date(parseCoordinatorTimestamp(job.completedAt)).toLocaleTimeString("vi-VN")}.`
      : "Đã dừng hoàn tất.";
  }
  if (job.status !== "cancelling") return null;

  const details: string[] = [];
  for (const agent of job.cancellation.pendingAgents) {
    details.push(agent.hasReceived
      ? `${agent.displayName} đã nhận lệnh, đang nhả ${agent.taskCount} task`
      : `đang chờ ${agent.displayName} nhận lệnh dừng (${agent.taskCount} task)`);
  }
  for (const pendingItem of job.cancellation.pendingPipeline) {
    const phase = formatCancellationPhase(pendingItem.phase);
    details.push(pendingItem.receivedAt
      ? `pipeline đã nhận lệnh, đang kết thúc bước ${phase} cho ${pendingItem.sourceKey}`
      : `đang chờ pipeline nhận lệnh dừng ở bước ${phase} cho ${pendingItem.sourceKey}`);
  }
  for (const cleanup of job.cancellation.pendingCleanupAgents) {
    details.push(cleanup.error
      ? `${cleanup.displayName} đang thử lại việc dọn cache (${cleanup.error})`
      : `${cleanup.displayName} đang đóng crawler và dọn cache`);
  }

  const elapsed = formatElapsedTime(job.cancellation.requestedAt, now);
  return details.length > 0
    ? `Đã gửi Stop ${elapsed}; ${details.join("; ")}.`
    : `Đã gửi Stop ${elapsed}; coordinator đang hoàn tất xác nhận dừng.`;
}
