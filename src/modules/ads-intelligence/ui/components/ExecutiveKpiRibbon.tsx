import React from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
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
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
          <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <AppIcon name="store" /> Giá trị đơn hàng (Shopify)
          </span>
          <span className="text-[11px] text-slate-500">Dữ liệu đơn hàng</span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div>
            <div className="text-xs text-slate-600">Giá trị sau hoàn tiền</div>
            <div className="text-lg font-semibold tabular-nums text-slate-900">
              {shopifySummary?.currency ?? summary?.currency ?? ""} {shopify?.netSales ?? "—"}
            </div>
            <div className="text-[11px] leading-4 text-slate-500">
              Trước hoàn tiền: {shopifySummary?.currency ?? summary?.currency ?? ""} {shopify?.grossSales ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-600">Đơn thực tế</div>
            <div className="text-lg font-semibold tabular-nums text-slate-900">
              {shopify?.totalOrders ?? "—"} đơn
            </div>
            <div className="text-[11px] leading-4 text-slate-500">Hoàn tiền: {shopifySummary?.currency ?? summary?.currency ?? ""} {shopify?.totalRefunds ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-600">AOV (Giá trị TB)</div>
            <div className="text-lg font-semibold tabular-nums text-slate-900">
              {shopifySummary?.currency ?? summary?.currency ?? ""} {shopify?.averageOrderValue ?? "—"}
            </div>
            <div className="text-[11px] leading-4 text-slate-500">/ đơn hàng</div>
          </div>
        </div>
      </div>

      {/* Cluster 2: Meta Ads Marketing */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
          <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <span><AppIcon name="chart" /></span> Quảng cáo Meta (Ads)
          </span>
          <span className="text-[11px] text-slate-500">
            {summary?.accountId ?? "—"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div>
            <div className="text-xs text-slate-600">Chi tiêu (Spend)</div>
            <div className="text-lg font-semibold tabular-nums text-slate-900">
              {summary?.currency ?? ""} {summary?.spend ?? meta?.spend ?? "—"}
            </div>
            <div className="text-[11px] leading-4 text-slate-500">Link Clicks: {summary?.linkClicks ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-600">Meta CPA</div>
            <div className="text-lg font-semibold tabular-nums text-slate-900">
              {summary?.currency ?? ""} {summary?.cpa ?? meta?.cpa ?? "—"}
            </div>
            <div className="text-[11px] leading-4 text-slate-500">Theo cấu hình và kỳ báo cáo của store</div>
          </div>
          <div>
            <div className="text-xs text-slate-600">Meta ROAS</div>
            <div className="text-lg font-semibold tabular-nums text-slate-900">
              {summary?.roas ?? meta?.roas ?? "—"}×
            </div>
            <div className="text-[11px] leading-4 text-slate-500">Purchases: {summary?.purchases ?? "—"}</div>
          </div>
        </div>
      </div>

      {/* Cluster 3: Unified Blended / Living Metrics */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
          <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <AppIcon name="chart" /> Đối soát Shopify & Meta
          </span>
          <span className="text-xs text-slate-600">Chưa xác định lợi nhuận</span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div>
            <div className="text-xs text-slate-600">Giá trị đơn / chi tiêu Meta</div>
            <div className="text-base font-bold text-emerald-700 font-mono">
              {reconciliation?.shopify.mer ?? "—"}×
            </div>
            <div className="text-[11px] leading-4 text-slate-500">Không phải lợi nhuận ròng</div>
          </div>
          <div>
            <div className="text-xs text-slate-600">Blended CPA</div>
            <div className="text-lg font-semibold tabular-nums text-slate-900">
              {summary?.currency ?? ""} {reconciliation?.shopify.blendedCpa ?? "—"}
            </div>
            <div className="text-[11px] leading-4 text-slate-500">Spend / Đơn Shop</div>
          </div>
          <div>
            <div className="text-xs text-slate-600">Phiên GA4 · Meta trả phí</div>
            <div className="text-base font-bold text-amber-700 font-mono">
              {reconciliation?.ga4.metaPaid?.sessions ?? "Chưa đọc được"}
            </div>
            <div className="text-[11px] leading-4 text-slate-500">
              Mọi nguồn: {reconciliation?.ga4.sessions ?? "—"} · Không phải tỷ lệ rơi rụng
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
