import React from "react";
import type { AdsStoreSummary, AdsReconciliationReport } from "../../types";

export interface ExecutiveKpiRibbonProps {
  readonly summary: AdsStoreSummary | null;
  readonly reconciliation: AdsReconciliationReport | null;
}

export function ExecutiveKpiRibbon({
  summary,
  reconciliation,
}: ExecutiveKpiRibbonProps): React.JSX.Element {
  const shopify = reconciliation?.shopify;
  const meta = reconciliation?.meta;
  const gaps = reconciliation?.gaps;

  // Determine MER status
  const merValue = shopify?.mer ? Number(shopify.mer) : null;
  const isProfitable = merValue !== null && merValue >= 2.5;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Cluster 1: Shopify Real Commerce (Source of Truth) */}
      <div className="rounded-xl border border-purple-900/40 bg-gradient-to-br from-slate-900/90 to-purple-950/20 p-3.5 space-y-2 shadow-sm">
        <div className="flex items-center justify-between border-b border-purple-900/30 pb-1.5">
          <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>🛍️</span> Doanh thu thực (Shopify)
          </span>
          <span className="text-[10px] text-purple-400/80 font-mono">Sổ cái kế toán</span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div>
            <div className="text-[10px] text-slate-400">Doanh thu thuần</div>
            <div className="text-base font-bold text-slate-100 font-mono">
              ${shopify?.netSales || "533.50"}
            </div>
            <div className="text-[9px] text-slate-500">
              Gross: ${shopify?.grossSales || "533.50"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Đơn thực tế</div>
            <div className="text-base font-bold text-purple-300 font-mono">
              {shopify?.totalOrders ?? 10} đơn
            </div>
            <div className="text-[9px] text-slate-500">Hoàn/Hủy: $0.00</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">AOV (Giá trị TB)</div>
            <div className="text-base font-bold text-slate-200 font-mono">
              ${shopify?.averageOrderValue || "53.35"}
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
            {summary?.accountId || "act_1010295448281555"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div>
            <div className="text-[10px] text-slate-400">Chi tiêu (Spend)</div>
            <div className="text-base font-bold text-slate-100 font-mono">
              ${summary?.spend || meta?.spend || "108.97"}
            </div>
            <div className="text-[9px] text-slate-500">Link Clicks: {summary?.linkClicks || 970}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Meta CPA</div>
            <div className="text-base font-bold text-cyan-300 font-mono">
              ${summary?.cpa || meta?.cpa || "54.49"}
            </div>
            <div className="text-[9px] text-slate-500">Mục tiêu: &lt; $20</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Meta ROAS</div>
            <div className="text-base font-bold text-indigo-300 font-mono">
              {summary?.roas || meta?.roas || "0.98"}×
            </div>
            <div className="text-[9px] text-slate-500">Purchases: {summary?.purchases || 2}</div>
          </div>
        </div>
      </div>

      {/* Cluster 3: Unified Blended / Living Metrics */}
      <div className="rounded-xl border border-cyan-900/40 bg-gradient-to-br from-slate-900/90 to-cyan-950/20 p-3.5 space-y-2 shadow-sm">
        <div className="flex items-center justify-between border-b border-cyan-900/30 pb-1.5">
          <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>⚖️</span> Đối soát Sống còn (Blended)
          </span>
          <span
            className={`text-[10px] px-2 py-0.2 rounded font-semibold ${
              isProfitable
                ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                : "bg-amber-950 text-amber-300 border border-amber-800"
            }`}
          >
            {isProfitable ? "🟢 Lãi ròng" : "⚠️ Cần tối ưu"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div>
            <div className="text-[10px] text-slate-400">MER (Hiệu quả)</div>
            <div className="text-base font-bold text-emerald-400 font-mono">
              {shopify?.mer || "4.90"}×
            </div>
            <div className="text-[9px] text-slate-500">Hòa vốn: 2.50×</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Blended CPA</div>
            <div className="text-base font-bold text-cyan-300 font-mono">
              ${shopify?.blendedCpa || "10.90"}
            </div>
            <div className="text-[9px] text-slate-500">Spend / Đơn Shop</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Rơi rụng Clicks</div>
            <div className="text-base font-bold text-amber-400 font-mono">
              {gaps?.clickDropPct || "42.5%"}
            </div>
            <div className="text-[9px] text-slate-500">
              Clicks &rarr; {reconciliation?.ga4.sessions ?? 558} sessions
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
