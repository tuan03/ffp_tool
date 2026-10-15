import React, { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { AdsGatewayStore, AdsStoreSummary } from "../../types";

export interface AdsHeaderProps {
  readonly stores: readonly AdsGatewayStore[];
  readonly currentStoreId: string;
  readonly onStoreChange: (newStoreId: string) => void;
  readonly summary: AdsStoreSummary | null;
  readonly syncing: boolean;
  readonly syncMessage: string | null;
  readonly onSync: () => void;
  readonly onOpenMcp: () => void;
  readonly onOpenProfile?: () => void;
}

export function AdsHeader({
  stores,
  currentStoreId,
  onStoreChange,
  summary,
  syncing,
  syncMessage,
  onSync,
  onOpenMcp,
  onOpenProfile,
}: AdsHeaderProps): React.JSX.Element {
  const [showMaturityTooltip, setShowMaturityTooltip] = useState(false);

  return (
    <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-slate-200 pb-4">
      {/* Brand & Store Identity */}
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Ads Intelligence</h1>

            {/* Compact Maturity Pill with Hover Tooltip */}
            <div className="relative inline-block">
              {!summary ? <span className="text-xs text-slate-600">Chưa xác định kỳ báo cáo</span> : summary.maturity === "PROVISIONAL" ? (
                <button
                  type="button"
                  onMouseEnter={() => setShowMaturityTooltip(true)}
                  onMouseLeave={() => setShowMaturityTooltip(false)}
                  onClick={() => setShowMaturityTooltip((v) => !v)}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-50 transition cursor-help font-medium"
                >
                  <span><AppIcon name="warning" /></span>
                  <span>Chưa đủ 7 ngày (Provisional)</span>
                </button>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                  Kỳ báo cáo đã qua 7 ngày
                </span>
              )}

              {showMaturityTooltip && (
                <div className="absolute left-0 top-full mt-1.5 z-50 w-72 p-2.5 rounded-lg bg-white text-xs text-slate-900 border border-amber-200 shadow-sm space-y-1">
                  <div className="font-semibold text-amber-700 flex items-center gap-1.5">
                    <span><AppIcon name="lock" /></span> Cổng kiểm soát độ chín chuyển đổi
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    Kỳ báo cáo ({summary?.periodStart} → {summary?.periodEnd}) kết thúc trong vòng 7 ngày gần nhất. Chuyển đổi Meta và hoàn tiền Shopify chưa đóng sổ hoàn toàn. Quyết định scale lớn bị khóa an toàn.
                  </p>
                </div>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-sm text-slate-600">
            Theo dõi quảng cáo, đối soát chuyển đổi và nghiên cứu đối thủ theo từng store.
          </p>
        </div>
      </div>

      {/* Control Actions & Store Switcher */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Source status indicator pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              !summary ? "bg-slate-200" : summary.fromCache ? "bg-amber-700" : "bg-emerald-700"
            }`}
          />
          <span className="text-slate-700 font-medium">
            {!summary ? "Chưa có dữ liệu Meta" : summary.fromCache ? "Dữ liệu đã lưu tạm" : "Meta API"}
          </span>
          {summary?.cachedAt && (
            <span className="text-slate-500 font-mono text-xs">
              {new Date(summary.cachedAt).toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>

        {/* Store Selector */}
        <select
          value={currentStoreId}
          onChange={(e) => onStoreChange(e.target.value)}
          aria-label="Chọn cửa hàng"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-blue-700 font-medium focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300 cursor-pointer shadow-sm"
        >
          {stores.map(store => <option key={store.storeId} value={store.storeId}>{store.storeId} · {store.shopDomain}{store.hasProxy ? " · Proxy" : ""}</option>)}
        </select>

        {/* MCP & Codex Button */}
        <button
          type="button"
          onClick={onOpenMcp}
          className="flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 hover:border-blue-300 hover:text-slate-900 transition cursor-pointer"
          title="Xem thông số kết nối Model Context Protocol (MCP) và Custom GPT"
        >
          <span><AppIcon name="code" /></span>
          <span>MCP</span>
        </button>

        {/* Profile Settings Button */}
        {onOpenProfile && (
          <button
            type="button"
            onClick={onOpenProfile}
            className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition cursor-pointer"
            title="Cấu hình tài khoản Meta Ads, GA4 và Target CPA cho store này"
          >
            <span><AppIcon name="settings" /></span>
            <span>Cấu hình Ads</span>
          </button>
        )}

        {/* Refresh / Sync Button */}
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
            syncing
              ? "border-blue-200 bg-blue-50 text-blue-700 cursor-not-allowed opacity-80"
              : "border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-300 hover:text-slate-900 hover:shadow-md active:scale-95"
          }`}
          title="Xóa cache và gọi live Meta & GA4 API ngay lập tức"
        >
          <span className={syncing ? "inline-block animate-spin" : ""}><AppIcon name="refresh" /></span>
          <span>{syncing ? "Đang đồng bộ..." : "Đồng bộ mới"}</span>
        </button>
      </div>
    </header>
  );
}
