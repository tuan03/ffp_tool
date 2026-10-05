export function describeWorkerActivity(input: {
  readonly queueDepth: number;
  readonly successfulJobs: number;
  readonly failedAttempts: number;
  readonly quotaFailures: number;
}): string {
  if (input.quotaFailures > 0) return `Có ${input.quotaFailures} lượt bị giới hạn quota. Mở “Chi tiết sự cố” để kiểm tra.`;
  if (input.failedAttempts > 0) return `Có ${input.failedAttempts} lượt xử lý đã dừng hoặc không hoàn tất. Mở “Chi tiết sự cố” để kiểm tra.`;
  if (input.successfulJobs > 0) return `Codex đã hoàn thành ${input.successfulJobs} sản phẩm trong khoảng thời gian đã chọn.`;
  if (input.queueDepth > 0) return `Có ${input.queueDepth} sản phẩm đang chờ Codex xử lý; chưa có sản phẩm hoàn tất trong khoảng này.`;
  return "Không có sản phẩm đang chờ và chưa ghi nhận sự cố trong khoảng này.";
}
