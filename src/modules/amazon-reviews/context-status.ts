import { hasUsableReviewContext } from "./product-context";
import type { AmazonReviewJob } from "./types";

export interface ReviewContextIssue {
  readonly jobId: string | null;
  readonly source: string;
  readonly message: string;
}

interface ContextPresentation {
  readonly tone: "success" | "progress" | "warning" | "error";
  readonly title: string;
  readonly description: string;
}

export function isSameContextSource(source: string, job: AmazonReviewJob): boolean {
  const value = source.trim();
  if (value.toUpperCase() === job.asin.toUpperCase()) return true;
  try {
    const url = new URL(value);
    if (!/(^|\.)amazon\.[a-z.]+$/i.test(url.hostname)) return false;
    return url.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase() === job.asin.toUpperCase();
  } catch { return false; }
}

export function recoverContextIssue(issue: ReviewContextIssue | null, job: AmazonReviewJob): ReviewContextIssue | null {
  if (!issue) return null;
  // An old job's poll must not erase a failure for a different requested product.
  if (issue.jobId === job.jobId || (isSameContextSource(issue.source, job) && hasUsableReviewContext(job.reviewData.context))) return null;
  return issue;
}

export function getContextPresentation(job: AmazonReviewJob): ContextPresentation {
  if (hasUsableReviewContext(job.reviewData.context)) return {
    tone: "success", title: "Ngữ cảnh sản phẩm đã sẵn sàng",
    description: "Đã có dữ kiện để tạo review AI. Tiếp tục chọn sản phẩm Shopify và tạo mẫu QA bên dưới.",
  };
  if (job.reviewData.stopReason === "captcha" || job.reviewData.stopReason === "signin") return {
    tone: "warning", title: "Amazon cần xác minh",
    description: "Kiểm tra đăng nhập hoặc CAPTCHA trên agent, sau đó lấy lại ngữ cảnh.",
  };
  if (job.status === "queued") return {
    tone: "progress", title: "Đang chờ agent nhận việc",
    description: "Giữ trang này mở để theo dõi. Kiểm tra agent đã kết nối đúng server và không tạm dừng; không cần bấm lấy ngữ cảnh thêm lần nữa.",
  };
  if (job.status === "failed") return {
    tone: "error", title: "Chưa lấy được ngữ cảnh",
    description: "Agent chưa lấy được dữ kiện sản phẩm. Kiểm tra agent và kết nối Amazon rồi thử lại.",
  };
  if (["completed", "partial", "cancelled"].includes(job.status)) return {
    tone: "warning", title: job.status === "cancelled" ? "Đã dừng lấy ngữ cảnh" : "Dữ kiện sản phẩm chưa đủ",
    description: "Chưa thể tạo review AI. Kiểm tra agent và lấy lại ngữ cảnh.",
  };
  return { tone: "progress", title: "Agent đang lấy ngữ cảnh", description: "Đang đọc thông tin sản phẩm trên Amazon. Kết quả sẽ tự cập nhật tại đây." };
}
