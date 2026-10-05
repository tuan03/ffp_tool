import type {
  BenchmarkMeasurementStatus,
  BenchmarkPerformanceStatus,
  BenchmarkProductItem,
  SearchMetrics,
} from "../types";

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

export function formatPp(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)} pp`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

export function formatPositionChange(before: number | null | undefined, after: number | null | undefined): { readonly text: string; readonly tone: "positive" | "negative" | "neutral" } {
  if (before == null && after == null) return { text: "—", tone: "neutral" };
  if (before == null || after == null) return { text: after != null ? after.toFixed(1) : "—", tone: "neutral" };
  const improvement = before - after;
  if (Math.abs(improvement) < 0.05) return { text: `${before.toFixed(1)} → ${after.toFixed(1)} (ổn định)`, tone: "neutral" };
  const tone = improvement > 0 ? "positive" : "negative";
  const sign = improvement > 0 ? "+" : "−";
  return {
    text: `${before.toFixed(1)} → ${after.toFixed(1)} · ${sign}${Math.abs(improvement).toFixed(1)} bậc`,
    tone,
  };
}

export interface StatusBadge {
  readonly label: string;
  readonly className: string;
  readonly description: string;
}

export function getStatusBadge(
  performanceStatus: BenchmarkPerformanceStatus | string,
  measurementStatus?: BenchmarkMeasurementStatus | string,
  technicalFlags: readonly string[] = [],
): StatusBadge {
  if (technicalFlags.length > 0) {
    return {
      label: "Cần kiểm tra kỹ thuật",
      className: "bg-purple-950/80 text-purple-300 border-purple-800",
      description: `Lỗi kỹ thuật hoặc trạng thái index: ${technicalFlags.join(", ")}`,
    };
  }
  if (measurementStatus === "CONTENT_CHANGED") {
    return {
      label: "External Changes",
      className: "bg-amber-950/80 text-amber-300 border-amber-700",
      description: "Nội dung storefront thực tế đã bị chỉnh sửa ngoài snapshot của phiên bản FFP",
    };
  }
  if (measurementStatus === "BASELINE") {
    return {
      label: "Baseline · v0",
      className: "bg-slate-800 text-slate-300 border-slate-700",
      description: "Phiên bản gốc ban đầu (v0). Chưa có phiên bản SEO trước để so sánh hiệu quả.",
    };
  }
  if (measurementStatus === "WAITING_FOR_CRAWL") {
    return {
      label: "Chờ Google crawl",
      className: "bg-sky-950/80 text-sky-300 border-sky-800",
      description: "Phiên bản mới đã xuất bản nhưng Google URL Inspection chưa quan sát được lần crawl sau ngày public.",
    };
  }
  if (measurementStatus === "COLLECTING") {
    return {
      label: "Đang thu thập",
      className: "bg-blue-950/80 text-blue-300 border-blue-800",
      description: "Chưa đủ số ngày hoàn tất trong cửa sổ quan sát After (settling + window days).",
    };
  }
  if (measurementStatus === "INSUFFICIENT_DATA") {
    return {
      label: "Thiếu dữ liệu",
      className: "bg-slate-800 text-slate-400 border-slate-700",
      description: "Lượng hiển thị hoặc lượt nhấp chưa đạt ngưỡng tín hiệu tối thiểu theo cấu hình.",
    };
  }
  switch (performanceStatus) {
    case "IMPROVING":
      return {
        label: "Đang cải thiện",
        className: "bg-emerald-950/80 text-emerald-300 border-emerald-700",
        description: "Lượt nhấp tìm kiếm Google tăng ít nhất 20% và tối thiểu 10 lượt nhấp tuyệt đối.",
      };
    case "DECLINING":
      return {
        label: "Suy giảm",
        className: "bg-rose-950/80 text-rose-300 border-rose-800",
        description: "Lượt nhấp tìm kiếm Google giảm ít nhất 20% và tối thiểu 10 lượt nhấp tuyệt đối.",
      };
    case "MIXED":
      return {
        label: "Tín hiệu trái chiều",
        className: "bg-amber-950/80 text-amber-300 border-amber-800",
        description: "Có tín hiệu khác chiều (ví dụ: impressions tăng mạnh nhưng CTR hoặc position matched queries giảm).",
      };
    case "STABLE":
      return {
        label: "Ổn định",
        className: "bg-slate-800 text-slate-300 border-slate-600",
        description: "Hiệu suất dao động trong biên độ bình thường, chưa vượt ngưỡng biến động.",
      };
    default:
      return {
        label: "Chưa đánh giá",
        className: "bg-slate-900 text-slate-400 border-slate-800",
        description: "Chưa có đủ điều kiện để đánh giá hiệu quả.",
      };
  }
}

/**
 * Client-side HTML sanitizer conforming to AGENTS.md Rule 8.
 * Strips script tags, iframes, objects, forms, and inline event handlers.
 */
export function sanitizeHtmlContent(dirtyHtml: string): string {
  if (!dirtyHtml || typeof dirtyHtml !== "string") return "";
  if (!dirtyHtml.includes("<") && !dirtyHtml.includes(">")) return dirtyHtml;
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return dirtyHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "")
      .replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, 'href="#"');
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(dirtyHtml, "text/html");
    const forbidden = ["script", "iframe", "object", "embed", "link", "style", "form", "input", "button", "textarea", "select", "meta", "base"];
    for (const tag of forbidden) {
      const elements = doc.body.getElementsByTagName(tag);
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el?.parentNode) el.parentNode.removeChild(el);
      }
    }
    const all = doc.body.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      for (let j = el.attributes.length - 1; j >= 0; j--) {
        const attr = el.attributes[j];
        if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
        if (attr.name.toLowerCase() === "href" && attr.value.trim().toLowerCase().startsWith("javascript:")) el.setAttribute("href", "#");
      }
    }
    return doc.body.innerHTML;
  } catch {
    return "";
  }
}

export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): void {
  const escapeCell = (cell: string | number | null | undefined): string => {
    if (cell == null) return '""';
    const str = String(cell);
    if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  };
  const headerLine = headers.map(escapeCell).join(",");
  const dataLines = rows.map(row => row.map(escapeCell).join(","));
  const csvContent = "\uFEFF" + [headerLine, ...dataLines].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function exportBenchmarkCsv(
  items: readonly BenchmarkProductItem[],
  storeId: string,
  windowDays: number,
): void {
  const headers = [
    "Product Title",
    "Product URL",
    "Shopify GID",
    "Current Version",
    "Version Source",
    "Prompt Version",
    "Batch ID",
    "Published At",
    "External Drift",
    "SEO Age (days)",
    "Coverage (days)",
    "Target Window (days)",
    "Clicks After",
    "Clicks Before",
    "Clicks Delta",
    "Clicks Delta %",
    "Impressions After",
    "Impressions Before",
    "Impressions Delta",
    "Impressions Delta %",
    "CTR After",
    "CTR Before",
    "CTR Delta (pp)",
    "Position After",
    "Position Before",
    "Position Improvement",
    "Queries After",
    "Queries Before",
    "Queries Delta",
    "Organic Sessions After",
    "Organic Sessions Before",
    "Organic Sessions Delta",
    "Status Label",
    "Status Reason",
    "Technical Flags",
    "Ruleset Version",
    "Last Evaluated At",
  ];

  const rows = items.map(item => [
    item.title,
    item.url,
    item.shopifyProductGid,
    item.currentVersion,
    item.versionSource ?? "",
    item.promptVersion ?? "",
    item.batchId ?? "",
    item.publishedAt ?? "",
    item.hasExternalDrift ? "YES" : "NO",
    item.seoAge ?? "",
    item.coverageDays,
    item.targetDays,
    item.clicks.after,
    item.clicks.before ?? "",
    item.clicks.deltaAbsolute ?? "",
    item.clicks.deltaPercent != null ? `${item.clicks.deltaPercent}%` : "",
    item.impressions.after,
    item.impressions.before ?? "",
    item.impressions.deltaAbsolute ?? "",
    item.impressions.deltaPercent != null ? `${item.impressions.deltaPercent}%` : "",
    item.ctr.after != null ? `${(item.ctr.after * 100).toFixed(2)}%` : "",
    item.ctr.before != null ? `${(item.ctr.before * 100).toFixed(2)}%` : "",
    item.ctr.deltaPercentagePoints != null ? `${item.ctr.deltaPercentagePoints} pp` : "",
    item.position.after != null ? item.position.after.toFixed(1) : "",
    item.position.before != null ? item.position.before.toFixed(1) : "",
    item.position.improvement != null ? item.position.improvement.toFixed(1) : "",
    item.queries.afterCount,
    item.queries.beforeCount ?? "",
    item.queries.delta ?? "",
    item.organicSessions.isGscQueryFilterApplied ? "N/A (Query filter applied)" : item.organicSessions.after ?? "",
    item.organicSessions.before ?? "",
    item.organicSessions.deltaAbsolute ?? "",
    item.status.label,
    item.status.reason,
    item.status.technicalFlags.join("; "),
    item.status.rulesetVersion,
    item.status.lastEvaluatedAt ?? "",
  ]);

  const filename = `seo-benchmark-${storeId}-${windowDays}d-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsv(filename, headers, rows);
}

export const JOB_LABELS: Readonly<Record<string, string>> = { sync: "Đồng bộ GSC (legacy)", gsc_sync: "Đồng bộ Search Console", ga4_sync: "Đồng bộ GA4", crawl: "Kiểm tra website", inspection: "Kiểm tra chỉ mục", report: "Báo cáo", benchmark: "Tính benchmark", recommendation: "Đánh giá đề xuất", health: "Kiểm tra đồng bộ", pending: "Đang chờ", running: "Đang xử lý", done: "Hoàn tất", failed: "Không thành công" };

