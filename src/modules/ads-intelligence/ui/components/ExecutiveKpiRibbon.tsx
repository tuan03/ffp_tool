import React from "react";
import type { AdsShopifySummary, AdsStoreSummary, AdsReconciliationReport } from "../../types";

export interface ExecutiveKpiRibbonProps {
  readonly shopifySummary?: AdsShopifySummary | null;
  readonly summary: AdsStoreSummary | null;
  readonly reconciliation: AdsReconciliationReport | null;
}

export function ExecutiveKpiRibbon({
  shopifySummary,
  summary,
  reconciliation,
}: ExecutiveKpiRibbonProps): React.JSX.Element {
  const shopify = reconciliation?.shopify ?? shopifySummary;
  const meta = reconciliation?.meta;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Cluster 1: Shopify Real Commerce (Source of Truth) */}
      <div className="rounded-xl border border-purple-900/40 bg-gradient-to-br from-slate-900/90 to-purple-950/20 p-3.5 space-y-2 shadow-sm">
        <div className="flex items-center justify-between border-b border-purple-900/30 pb-1.5">
          <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>🛍️</span> Giá trị đơn hàng (Shopify)
          </span>
          <span className="text-[10px] text-purple-400/80 font-mono">Dữ liệu đơn hàng</span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div>
            <div className="text-[10px] text-slate-400">Giá trị sau hoàn tiền</div>
            <div className="text-base font-bold text-slate-100 font-mono">
              {shopifySummary?.currency ?? summary?.currency ?? ""} {shopify?.netSales ?? "—"}
            </div>
            <div className="text-[9px] text-slate-500">
              Trước hoàn tiền: {shopifySummary?.currency ?? summary?.currency ?? ""} {shopify?.grossSales ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Đơn thực tế</div>
            <div className="text-base font-bold text-purple-300 font-mono">
              {shopify?.totalOrders ?? "—"} đơn
            </div>
            <div className="text-[9px] text-slate-500">Hoàn tiền: {shopifySummary?.currency ?? summary?.currency ?? ""} {shopify?.totalRefunds ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">AOV (Giá trị TB)</div>
            <div className="text-base font-bold text-slate-200 font-mono">
              {shopifySummary?.currency ?? summary?.currency ?? ""} {shopify?.averageOrderValue ?? "—"}
            </div>
            <div className="text-[9px] text-slate-500">/ đơn hàng</div>
          </div>
        </div>
      </div>

      {/* Cluster 2: Meta Ads Marketing */}
      <div className="rounded-xl border border-blue-900/40 bg-gradient-to-br from-slate-900/90 to-blue-950/20 p-3.5 space-y-2 shadow-sm">
        <div className="flex items-center justify-between border-b border-blue-900/30 pb-1.5">
          <span className="text-[11px] font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>📊</span> Quảng cáo Meta (Ads)
          </span>
          <span className="text-[10px] text-blue-400/80 font-mono">
            {summary?.accountId ?? "—"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div>
            <div className="text-[10px] text-slate-400">Chi tiêu (Spend)</div>
            <div className="text-base font-bold text-slate-100 font-mono">
              {summary?.currency ?? ""} {summary?.spend ?? meta?.spend ?? "—"}
            </div>
            <div className="text-[9px] text-slate-500">Link Clicks: {summary?.linkClicks ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Meta CPA</div>
            <div className="text-base font-bold text-cyan-300 font-mono">
              {summary?.currency ?? ""} {summary?.cpa ?? meta?.cpa ?? "—"}
            </div>
            <div className="text-[9px] text-slate-500">Theo cấu hình và kỳ báo cáo của store</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Meta ROAS</div>
            <div className="text-base font-bold text-indigo-300 font-mono">
              {summary?.roas ?? meta?.roas ?? "—"}×
            </div>
            <div className="text-[9px] text-slate-500">Purchases: {summary?.purchases ?? "—"}</div>
          </div>
        </div>
      </div>

      {/* Cluster 3: Unified Blended / Living Metrics */}
      <div className="rounded-xl border border-cyan-900/40 bg-gradient-to-br from-slate-900/90 to-cyan-950/20 p-3.5 space-y-2 shadow-sm">
        <div className="flex items-center justify-between border-b border-cyan-900/30 pb-1.5">
          <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>⚖️</span> Đối soát Sống còn (Blended)
          </span>
          <span className="text-[10px] text-slate-400">Chưa xác định lợi nhuận</span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div>
            <div className="text-[10px] text-slate-400">Giá trị đơn / chi tiêu Meta</div>
            <div className="text-base font-bold text-emerald-400 font-mono">
              {reconciliation?.shopify.mer ?? "—"}×
            </div>
            <div className="text-[9px] text-slate-500">Không phải lợi nhuận ròng</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Blended CPA</div>
            <div className="text-base font-bold text-cyan-300 font-mono">
              {summary?.currency ?? ""} {reconciliation?.shopify.blendedCpa ?? "—"}
            </div>
            <div className="text-[9px] text-slate-500">Spend / Đơn Shop</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Phiên GA4 · Meta trả phí</div>
            <div className="text-base font-bold text-amber-400 font-mono">
              {reconciliation?.ga4.metaPaid?.sessions ?? "Chưa đọc được"}
            </div>
            <div className="text-[9px] text-slate-500">
              Mọi nguồn: {reconciliation?.ga4.sessions ?? "—"} · Không phải tỷ lệ rơi rụng
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
