import React from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { AdsReconciliationReport, AdsStoreSummary } from "../../types";

import { describeReconciliation } from "../reconciliation-analysis";

export interface FunnelTabProps {
  readonly reconciliation: AdsReconciliationReport | null;
  readonly summary: AdsStoreSummary | null;
}

export function FunnelTab({ reconciliation, summary }: FunnelTabProps): React.JSX.Element {
  const meta = reconciliation?.meta;
  const shopify = reconciliation?.shopify;
  const paid = reconciliation?.ga4.metaPaid;
  const hasPaid = paid?.status === "AVAILABLE";
  const missing = "Chưa có dữ liệu";
  const money = (value: string | number | null | undefined, currency = summary?.currency): string =>
    value === null || value === undefined ? missing : `${currency ?? ""} ${value}`;
  const clicks = meta?.linkClicks ?? summary?.linkClicks;
  const purchases = meta?.purchases ?? summary?.purchases;
  const cpa = meta?.cpa ?? summary?.cpa;
  const steps = [
    { label: "1. Link Clicks", value: clicks, source: "Meta Ads", color: "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300" },
    { label: "2. Sessions", value: hasPaid ? paid.sessions : null, source: "GA4 · Meta trả phí", color: "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300" },
    { label: "3. Landing Page Views", value: summary?.lpv, source: "Meta · lượt xem trang đích", color: "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300" },
    { label: "4. Add To Cart", value: summary?.atc, source: "Meta · thêm giỏ hàng", color: "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300" },
    { label: "5. Checkouts", value: summary?.checkout, source: "Meta · bắt đầu thanh toán", color: "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300" },
    { label: "6. Purchases", value: shopify?.totalOrders, source: "Shopify · đơn đủ điều kiện", color: "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300" },
  ];
  const analysis = describeReconciliation(reconciliation, summary);
  const rows = [
    ["Chi phí Quảng cáo", money(meta?.spend ?? summary?.spend), "Không áp dụng", "Không áp dụng", analysis.spend],
    ["Lưu lượng truy cập", clicks == null ? missing : `${clicks} Link Clicks`, hasPaid ? `${paid.sessions} Sessions` : missing, "Chưa thu thập", analysis.traffic],
    ["Số đơn chuyển đổi", purchases ?? missing, hasPaid ? paid.ecommercePurchases ?? missing : missing, shopify?.totalOrders ?? missing,
      analysis.orders],
    ["Doanh thu ghi nhận", money(meta?.purchaseValue ?? summary?.purchaseValue), hasPaid ? money(paid.purchaseRevenue, paid.currency ?? undefined) : missing, money(shopify?.netSales), analysis.revenue],
    ["Hoàn tiền", "Chưa thu thập", "Chưa thu thập", money(shopify?.totalRefunds), analysis.refunds],
    ["Chi phí trên đơn (CPA)", cpa != null ? money(cpa) : purchases != null && Number(purchases) === 0 ? "Không tính được (0 purchases)" : missing, "Chưa đối soát chi phí",
      shopify?.blendedCpa != null ? `${money(shopify.blendedCpa)} Blended` : shopify?.totalOrders === 0 ? "Không tính được (0 đơn)" : missing,
      analysis.cpa],
    ["Tỷ số giá trị / chi tiêu", (meta?.roas ?? summary?.roas) == null ? missing : `${meta?.roas ?? summary?.roas}× ROAS`, "Chưa đối soát chi phí", shopify?.mer == null ? missing : `${shopify.mer}× Shopify / Meta`, analysis.ratio],
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><span><AppIcon name="refresh" /></span> Dòng chảy Phễu Chuyển đổi (Conversion Funnel Flow)</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">Các chỉ số theo nguồn; chưa phải phễu tuần tự của cùng một nhóm người dùng.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 pt-2">
          {steps.map(step => <div key={step.label} className={`rounded-lg border p-3 space-y-1.5 ${step.color}`}>
            <span className="text-xs font-bold uppercase">{step.label}</span>
            <div className="text-xl font-bold font-mono">{step.value ?? missing}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400">{step.source}</div>
          </div>)}
        </div>
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
          Múi giờ Meta: {summary?.timezone ?? missing}; GA4: {paid?.timezone ?? missing}. Không tính tỷ lệ hoàn tất hoặc rơi rụng xuyên nguồn khi chưa khớp phạm vi.
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5 space-y-4 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><span>⚖️</span> Ma trận Đối soát 3 bên (Meta vs GA4 vs Shopify)</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">Kỳ {reconciliation?.periodStart ?? summary?.periodStart ?? "—"} → {reconciliation?.periodEnd ?? summary?.periodEnd ?? "—"}. Mỗi nguồn có cách ghi nhận chuyển đổi riêng.</p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 uppercase text-xs font-mono border-b border-slate-200 dark:border-slate-700">
              <tr>{["Chỉ số đối soát", "Meta Ads", "Google Analytics 4 · Meta trả phí", "Shopify Store", "Độ chênh lệch & Phân tích"].map(label => <th scope="col" key={label} className="py-2.5 px-4">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700 font-mono text-xs">
              {rows.map(([label, metaValue, ga4Value, shopifyValue, analysis]) => <tr key={label} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                <th scope="row" className="py-3 px-4 font-sans font-semibold text-slate-700 dark:text-slate-300">{label}</th>
                <td className="py-3 px-4 text-blue-700 dark:text-blue-300">{metaValue}</td>
                <td className="py-3 px-4 text-blue-700 dark:text-blue-300">{ga4Value}</td>
                <td className="py-3 px-4 text-emerald-700 dark:text-emerald-300">{shopifyValue}</td>
                <td className="py-3 px-4 font-sans text-slate-700 dark:text-slate-300">{analysis}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">GA4 mọi nguồn: {reconciliation?.ga4.sessions ?? missing} sessions. Nguồn Meta chưa xác minh trả phí: {paid?.unverifiedMetaSessions ?? missing} sessions (giữ riêng).</p>
        {paid?.warnings.map(warning => <p key={warning} className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>)}
        {shopify && <p className="text-xs text-slate-600 dark:text-slate-400">Shopify: {shopify.source}</p>}
        <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-400">{reconciliation?.gaps.notes.map(note => <li key={note}>{note}</li>)}</ul>
      </div>
    </div>
  );
}
