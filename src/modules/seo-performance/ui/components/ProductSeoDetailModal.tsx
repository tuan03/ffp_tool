import { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { ProductSeoDetailData } from "../../types";
import {
  displayDate,
  formatPercent,
  formatPositionChange,
  formatPp,
  getStatusBadge,
  sanitizeHtmlContent,
} from "../presentation";

interface ProductSeoDetailModalProps {
  readonly data: ProductSeoDetailData;
  readonly onClose: () => void;
  readonly onSendToAutoSeo?: (productId: string, recommendationId?: string) => Promise<void>;
}

export function ProductSeoDetailModal({
  data,
  onClose,
  onSendToAutoSeo,
}: ProductSeoDetailModalProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"summary" | "content" | "queries" | "ga4" | "recommendations">("summary");
  const [isRawTextMode, setIsRawTextMode] = useState(false);
  const [queryCategory, setQueryCategory] = useState<"all" | "matched" | "new" | "lost">("all");
  const [isSending, setIsSending] = useState(false);
  const [sendSuccessMessage, setSendSuccessMessage] = useState("");
  const [sendError, setSendError] = useState("");

  const product = data.product;
  const statusBadge = getStatusBadge(
    product.status.performanceStatus,
    product.status.measurementStatus,
    product.status.technicalFlags,
  );

  const filteredQueries = data.queries.filter(q => {
    if (queryCategory === "all") return true;
    return q.category === queryCategory;
  });

  const handleSendToAutoSeo = async (recommendationId?: string) => {
    if (!window.confirm("Tạo bản thảo yêu cầu Auto-SEO gửi sang hệ thống Codex? Thao tác này sẽ tạo job draft an toàn và không tự xuất bản lên Shopify.")) {
      return;
    }
    setIsSending(true);
    setSendError("");
    setSendSuccessMessage("");
    try {
      if (onSendToAutoSeo) {
        await onSendToAutoSeo(product.productId, recommendationId);
      }
      setSendSuccessMessage("Đã gửi ngữ cảnh đối chứng sang Auto-SEO thành công! Bản thảo đang chờ xử lý qua các checkpoint.");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Không thể gửi sang Auto-SEO.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50 p-4 backdrop-blur-sm"
    >
      <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-slate-300 bg-white shadow-sm">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-200 p-4 sm:p-5">
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                {product.currentVersion}
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge.className}`}>
                {statusBadge.label}
              </span>
              <span className="text-xs text-slate-600">
                {product.shopifyProductGid}
              </span>
            </div>
            <h2 id="modal-title" className="mt-1 truncate text-lg font-bold text-slate-900 sm:text-xl">
              {product.title}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <a
                href={product.url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 hover:underline"
              >
                Mở Storefront ↗
              </a>
              <span>·</span>
              <span>
                SEO Age: <strong>{product.seoAge != null ? `${product.seoAge}d` : "—"}</strong> ({product.coverageDays}/{product.targetDays}d đối chứng)
              </span>
              <span>·</span>
              <span>Publish: {displayDate(product.publishedAt)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600/30"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <nav
          aria-label="Các tab chi tiết sản phẩm"
          className="flex border-b border-slate-200 bg-slate-50 px-4 text-xs font-medium sm:text-sm"
        >
          {[
            { id: "summary", label: "1. Tổng quan & Timeline" },
            { id: "content", label: "2. Nội dung & Lịch sử phiên bản" },
            { id: "queries", label: `3. Từ khóa GSC (${data.queries.length})` },
            { id: "ga4", label: "4. Chỉ số GA4" },
            { id: "recommendations", label: `5. Đề xuất & Audit (${data.recommendations.length})` },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`border-b-2 px-4 py-3 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-300 font-semibold text-blue-700"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* TAB 1: SUMMARY & TIMELINE */}
          {activeTab === "summary" && (
            <div className="space-y-6">
              {/* URL Inspection Card */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Trạng thái Google URL Inspection</h3>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                  <div>
                    <span className="text-slate-500">Kết quả Index:</span>
                    <div className="mt-0.5 font-semibold text-emerald-700">{data.inspection.verdict}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Lần crawl cuối:</span>
                    <div className="mt-0.5 text-slate-900">{displayDate(data.inspection.lastCrawlAt)}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Trạng thái Coverage:</span>
                    <div className="mt-0.5 text-slate-900">{data.inspection.coverageState}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Chỉ thị Robots:</span>
                    <div className="mt-0.5 text-slate-900">{data.inspection.robotsState}</div>
                  </div>
                </div>
                <div className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-600 flex flex-wrap gap-4">
                  <span>Canonical của trang: <code className="text-slate-700">{data.inspection.userCanonical}</code></span>
                  <span>Google Canonical: <code className="text-slate-700">{data.inspection.googleCanonical}</code></span>
                </div>
              </div>

              {/* Before vs After Benchmark Metrics */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900">So sánh đối chứng Trước (Before) và Sau (After)</h3>
                <p className="mt-0.5 text-xs text-slate-600">
                  Cửa sổ Before: {data.windows.beforeStart} → {data.windows.beforeEnd} · Cửa sổ After: {data.windows.afterStart} → {data.windows.afterEnd} (Settling: {data.windows.settlingDays} ngày · Timezone: {data.windows.sourceTimezone})
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5 text-center">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <span className="text-xs text-slate-600">Clicks</span>
                    <div className="mt-1 text-xl font-bold text-slate-900">{product.clicks.after}</div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {product.clicks.before != null ? `${product.clicks.before} → ${product.clicks.after}` : "—"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <span className="text-xs text-slate-600">Impressions</span>
                    <div className="mt-1 text-xl font-bold text-slate-900">{product.impressions.after}</div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {product.impressions.before != null ? `${product.impressions.before} → ${product.impressions.after}` : "—"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <span className="text-xs text-slate-600">CTR</span>
                    <div className="mt-1 text-xl font-bold text-slate-900">
                      {product.ctr.after != null ? `${(product.ctr.after * 100).toFixed(2)}%` : "—"}
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {formatPp(product.ctr.deltaPercentagePoints)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <span className="text-xs text-slate-600">Vị trí trung bình</span>
                    <div className="mt-1 text-xl font-bold text-slate-900">
                      {product.position.after != null ? product.position.after.toFixed(1) : "—"}
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {formatPositionChange(product.position.before, product.position.after).text}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <span className="text-xs text-slate-600">Google Organic Sessions</span>
                    <div className="mt-1 text-xl font-bold text-slate-900">
                      {product.organicSessions.after != null ? product.organicSessions.after : "—"}
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {product.organicSessions.deltaAbsolute != null ? `+${product.organicSessions.deltaAbsolute}` : "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Timeline Annotations */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Dòng thời gian & Sự kiện tác động (Timeline)</h3>
                <div className="mt-3 space-y-2">
                  {data.timelineAnnotations.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                      <span className="rounded bg-slate-50 px-2 py-0.5 font-mono text-blue-700">
                        {item.date}
                      </span>
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700 border border-blue-200 uppercase text-xs">
                        {item.type}
                      </span>
                      <span className="text-slate-700 flex-1">{item.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CONTENT & VERSION HISTORY */}
          {activeTab === "content" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="text-xs text-slate-600">
                  Đang so sánh: <strong>v{data.selectedVersionNumber}</strong> (sau khi áp dụng) với <strong>v{data.comparedVersionNumber}</strong> (trước đó)
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600">Chế độ xem:</span>
                  <button
                    type="button"
                    onClick={() => setIsRawTextMode(false)}
                    className={`rounded px-2.5 py-1 text-xs font-semibold ${
                      !isRawTextMode ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-600"
                    }`}
                  >
                    Visual HTML
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRawTextMode(true)}
                    className={`rounded px-2.5 py-1 text-xs font-semibold ${
                      isRawTextMode ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-600"
                    }`}
                  >
                    Raw Text
                  </button>
                </div>
              </div>

              {/* Field Diffs */}
              <div className="space-y-4">
                {data.diffs.map(diff => (
                  <div key={diff.field} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span>{diff.label}</span>
                      {diff.hasChanged ? (
                        <span className="text-emerald-700">✓ Đã thay đổi</span>
                      ) : (
                        <span className="text-slate-500">Giữ nguyên</span>
                      )}
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs">
                      {/* Before */}
                      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                        <span className="font-semibold text-rose-700">Trước (v{data.comparedVersionNumber}):</span>
                        {isRawTextMode || diff.field !== "descriptionHtml" ? (
                          <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-700">{diff.before}</pre>
                        ) : (
                          <div
                            className="mt-1 text-slate-700 prose prose-invert prose-xs"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtmlContent(diff.before) }}
                          />
                        )}
                      </div>

                      {/* After */}
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                        <span className="font-semibold text-emerald-700">Sau (v{data.selectedVersionNumber}):</span>
                        {isRawTextMode || diff.field !== "descriptionHtml" ? (
                          <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-700">{diff.after}</pre>
                        ) : (
                          <div
                            className="mt-1 text-slate-700 prose prose-invert prose-xs"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtmlContent(diff.after) }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Media Alt Diffs */}
                {data.mediaDiffs.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <h4 className="text-xs font-semibold text-slate-700">Thay đổi Alt Text hình ảnh (Media Alt Diffs)</h4>
                    <div className="mt-3 space-y-3">
                      {data.mediaDiffs.map(media => (
                        <div key={media.mediaId} className="flex items-center gap-4 rounded-lg bg-slate-50 p-3 text-xs">
                          <img src={media.url} alt="" className="h-14 w-14 shrink-0 rounded object-cover border border-slate-300" />
                          <div className="min-w-0 flex-1 grid gap-2 sm:grid-cols-2">
                            <div>
                              <span className="text-rose-700 font-medium">Trước:</span>
                              <div className="text-slate-600 italic">{media.beforeAlt || "(không có alt)"}</div>
                            </div>
                            <div>
                              <span className="text-emerald-700 font-medium">Sau:</span>
                              <div className="text-slate-900">{media.afterAlt}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SEARCH & QUERIES */}
          {activeTab === "queries" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600">Nhóm từ khóa:</span>
                  {(["all", "matched", "new", "lost"] as const).map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setQueryCategory(cat)}
                      className={`rounded px-2.5 py-1 text-xs font-semibold ${
                        queryCategory === cat
                          ? "bg-blue-600 text-white"
                          : "bg-slate-50 text-slate-700 hover:text-slate-900"
                      }`}
                    >
                      {cat === "all" ? `Tất cả (${data.queries.length})` : cat === "matched" ? "Trùng khớp (Matched)" : cat === "new" ? "Mới xuất hiện (New)" : "Không còn thấy (No longer observed)"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50 text-slate-600 uppercase">
                    <tr>
                      <th className="px-3 py-2.5">Từ khóa (Query)</th>
                      <th className="px-3 py-2.5 text-center">Phân loại</th>
                      <th className="px-3 py-2.5 text-right">Clicks Before → After</th>
                      <th className="px-3 py-2.5 text-right">Impressions Before → After</th>
                      <th className="px-3 py-2.5 text-right">CTR After</th>
                      <th className="px-3 py-2.5 text-right">Vị trí trung bình</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredQueries.map(q => (
                      <tr key={q.query} className="hover:bg-slate-100">
                        <td className="px-3 py-2.5 font-medium text-slate-900">{q.query}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                              q.category === "matched"
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : q.category === "new"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                          >
                            {q.category === "matched" ? "Matched" : q.category === "new" ? "Newly Observed" : "No longer observed"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {q.beforeClicks ?? "—"} → <strong>{q.afterClicks ?? "—"}</strong>
                          {q.clicksDelta != null && (
                            <span className={q.clicksDelta > 0 ? "text-emerald-700 ml-1" : "text-rose-700 ml-1"}>
                              ({q.clicksDelta > 0 ? "+" : ""}{q.clicksDelta})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {q.beforeImpressions ?? "—"} → <strong>{q.afterImpressions ?? "—"}</strong>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {q.afterCtr != null ? `${(q.afterCtr * 100).toFixed(2)}%` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {q.beforePosition != null ? `${q.beforePosition.toFixed(1)} → ` : ""}
                          <strong>{q.afterPosition != null ? q.afterPosition.toFixed(1) : "—"}</strong>
                          {q.positionImprovement != null && (
                            <span className={q.positionImprovement > 0 ? "text-emerald-700 ml-1" : "text-rose-700 ml-1"}>
                              ({q.positionImprovement > 0 ? "+" : ""}{q.positionImprovement.toFixed(1)})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: GA4 */}
          {activeTab === "ga4" && (
            <div className="space-y-6">
              {data.ga4.isGscQueryFilterNotice && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  <AppIcon name="warning" /> Báo cáo GA4 không hỗ trợ lọc theo GSC Query. Dữ liệu bên dưới thể hiện toàn bộ phiên Organic landing vào trang này.
                </div>
              )}

              {/* GA4 Core Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-xs text-slate-600">Landing Sessions</span>
                  <div className="mt-1 text-xl font-bold text-slate-900">{data.ga4.landingSessions.current}</div>
                  <div className="text-xs text-emerald-700">+{data.ga4.landingSessions.delta} so với kỳ trước</div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-xs text-slate-600">Tổng Users</span>
                  <div className="mt-1 text-xl font-bold text-slate-900">{data.ga4.totalUsers.current}</div>
                  <div className="text-xs text-emerald-700">+{data.ga4.totalUsers.delta}</div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-xs text-slate-600">Phiên tương tác (Engaged)</span>
                  <div className="mt-1 text-xl font-bold text-slate-900">{data.ga4.engagedSessions.current}</div>
                  <div className="text-xs text-slate-600">Tỷ lệ: {(data.ga4.engagementRate.current * 100).toFixed(1)}%</div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-xs text-slate-600">Doanh thu mua hàng</span>
                  <div className="mt-1 text-xl font-bold text-emerald-700">
                    ${data.ga4.purchaseRevenue.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} {data.ga4.purchaseRevenue.currency}
                  </div>
                  <div className="text-xs text-slate-600">{data.ga4.eventCounts.purchase} đơn hàng</div>
                </div>
              </div>

              {/* GA4 Funnel Events */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-xs font-semibold text-slate-700">Phễu chuyển đổi E-commerce (Events)</h4>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                  <div className="rounded bg-white p-2">
                    <span className="text-slate-600">view_item</span>
                    <div className="text-lg font-bold text-slate-900">{data.ga4.eventCounts.viewItem}</div>
                  </div>
                  <div className="rounded bg-white p-2">
                    <span className="text-slate-600">add_to_cart</span>
                    <div className="text-lg font-bold text-slate-900">{data.ga4.eventCounts.addToCart}</div>
                  </div>
                  <div className="rounded bg-white p-2">
                    <span className="text-slate-600">begin_checkout</span>
                    <div className="text-lg font-bold text-slate-900">{data.ga4.eventCounts.beginCheckout}</div>
                  </div>
                  <div className="rounded bg-white p-2">
                    <span className="text-slate-600">purchase</span>
                    <div className="text-lg font-bold text-emerald-700">{data.ga4.eventCounts.purchase}</div>
                  </div>
                </div>
              </div>

              {/* Acquisition Channels */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-xs font-semibold text-slate-700">Kênh lưu lượng truy cập (Acquisition)</h4>
                <div className="mt-3 divide-y divide-slate-200 text-xs">
                  {data.ga4.acquisition.map(ch => (
                    <div key={ch.channel} className="flex justify-between py-2">
                      <span className="font-medium text-slate-700">{ch.channel}</span>
                      <span className="text-slate-600">{ch.sessions} sessions · {ch.users} users</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: RECOMMENDATIONS & AUDIT */}
          {activeTab === "recommendations" && (
            <div className="space-y-6">
              {sendSuccessMessage && (
                <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-700">
                  {sendSuccessMessage}
                </div>
              )}
              {sendError && (
                <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
                  {sendError}
                </div>
              )}

              {/* Action Button: Send to Auto-SEO */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-blue-700">Tạo bản sửa SEO tự động (Send to Auto-SEO)</h4>
                  <p className="mt-0.5 text-xs text-slate-600">
                    Chuyển toàn bộ ngữ cảnh đối chứng, bằng chứng từ khóa và snapshot sang Auto-SEO để tạo dự thảo cải thiện.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleSendToAutoSeo()}
                  disabled={isSending}
                  className="rounded-lg border border-blue-300 bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSending ? "Đang gửi ngữ cảnh..." : "Send to Auto-SEO"}
                </button>
              </div>

              {/* Existing Recommendations */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase text-slate-600">Đề xuất xử lý từ hệ thống</h4>
                {data.recommendations.length === 0 ? (
                  <p className="text-xs text-slate-500">Chưa có đề xuất nào được tạo cho sản phẩm này.</p>
                ) : (
                  data.recommendations.map(rec => (
                    <div key={rec.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{rec.issue}</span>
                        <span className="rounded bg-slate-50 px-2 py-0.5 text-xs text-slate-600">{rec.priority} priority</span>
                      </div>
                      <p className="text-slate-600">{rec.rationale}</p>
                      <div className="rounded bg-white p-2 text-slate-700 whitespace-pre-wrap">{rec.proposed}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          <span>Quy tắc đánh giá: <code>{product.status.rulesetVersion}</code></span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 font-medium text-slate-900 hover:bg-slate-100"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
