export function createAgentPrompt({ storeId, target, runId }: {
  readonly storeId: string; readonly target: number; readonly runId?: string;
}): string {
  if (!runId && (!Number.isSafeInteger(target) || target < 1)) return "";
  return [
    "Sử dụng $ffp-seo.",
    runId
      ? `Tiếp tục phiên ${JSON.stringify(runId)} của store ${JSON.stringify(storeId)}, chỉ xử lý phần còn thiếu; không tạo phiên mới.`
      : `Xử lý SEO cho ${target} sản phẩm trong Queue của store ${JSON.stringify(storeId)}, chỉ tạo bản nháp chờ duyệt.`,
    "Kiểm tra worker_status; nếu cần, chọn đúng store được cấp quyền bằng worker_select_store rồi kiểm tra lại. Không đổi store khi còn công việc đang chạy.",
    "Chỉ tính hoàn thành khi bản nháp đã vào Review. Không phê duyệt hoặc đồng bộ lên Shopify.",
    "Nếu bị gián đoạn, báo ID phiên và số sản phẩm đã hoàn thành để tiếp tục sau.",
  ].join("\n\n");
}
