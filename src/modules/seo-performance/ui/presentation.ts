import type { SearchMetrics } from "../types";

export const METRIC_LABELS: Record<keyof SearchMetrics, string> = {
  clicks: "Lượt nhấp", impressions: "Lượt hiển thị", ctr: "Tỷ lệ nhấp (CTR)", position: "Vị trí trung bình",
};
export function presetPeriod(endDate: string, days: number): { startDate: string; endDate: string } {
  return { startDate: new Date(Date.parse(endDate) - (days - 1) * 86400000).toISOString().slice(0, 10), endDate };
}
export function formatMetric(value: number | null | undefined, metric: keyof SearchMetrics): string {
  return value == null ? "—" : metric === "ctr" ? `${(value * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%` : value.toLocaleString("vi-VN", { maximumFractionDigits: metric === "position" ? 2 : 0 });
}
export function metricChange(metric: keyof SearchMetrics, current: number | null | undefined, previous: number | null | undefined): { text: string; tone: "positive" | "negative" | "neutral" } {
  if (current == null || previous == null) return { text: "Chưa đủ dữ liệu so sánh", tone: "neutral" };
  const delta = current - previous;
  if (!delta) return { text: "Không thay đổi", tone: "neutral" };
  const tone = (metric === "position" ? -delta : delta) > 0 ? "positive" : "negative";
  const magnitude = metric === "ctr" ? `${(Math.abs(delta) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} điểm %` : formatMetric(Math.abs(delta), metric);
  return { text: `${delta > 0 ? "↑" : "↓"} ${magnitude}${metric === "position" ? " bậc" : ""}`, tone };
}
export function displayDate(value: string | null | undefined): string {
  if (!value) return "Chưa có";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("vi-VN", { timeZone: "UTC" }) : value;
}
export const JOB_LABELS: Readonly<Record<string, string>> = { sync: "Đồng bộ Google", crawl: "Kiểm tra website", inspection: "Kiểm tra chỉ mục", report: "Báo cáo", pending: "Đang chờ", running: "Đang xử lý", done: "Hoàn tất", failed: "Không thành công" };
