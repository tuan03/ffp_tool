import React, { useState } from "react";
import type { AdsStoreSummary } from "../../types";

export interface AdsHeaderProps {
  readonly currentStoreId: string;
  readonly onStoreChange: (newStoreId: string) => void;
  readonly summary: AdsStoreSummary | null;
  readonly syncing: boolean;
  readonly syncMessage: string | null;
  readonly onSync: () => void;
  readonly onOpenMcp: () => void;
}

export function AdsHeader({
  currentStoreId,
  onStoreChange,
  summary,
  syncing,
  syncMessage,
  onSync,
  onOpenMcp,
}: AdsHeaderProps): React.JSX.Element {
  const [showMaturityTooltip, setShowMaturityTooltip] = useState(false);

  return (
    <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-slate-800 pb-4">
      {/* Brand & Store Identity */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-xl shadow-lg shadow-cyan-500/20">
          🎯
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-slate-100 tracking-tight">Ads Intelligence</h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-800/80 font-mono font-semibold">
              V1 Pro
            </span>

            {/* Compact Maturity Pill with Hover Tooltip */}
            <div className="relative inline-block">
              {summary?.maturity === "PROVISIONAL" ? (
                <button
                  type="button"
                  onMouseEnter={() => setShowMaturityTooltip(true)}
                  onMouseLeave={() => setShowMaturityTooltip(false)}
                  onClick={() => setShowMaturityTooltip((v) => !v)}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-800/70 hover:bg-amber-900/60 transition cursor-help font-medium"
                >
                  <span>⚠️</span>
                  <span>Chưa đủ 7 ngày (Provisional)</span>
                </button>
              ) : (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-800/70 font-medium">
                  ✓ Dữ liệu chuẩn (Finalized)
                </span>
              )}

              {showMaturityTooltip && (
                <div className="absolute left-0 top-full mt-1.5 z-50 w-72 p-2.5 rounded-lg bg-slate-900 text-xs text-slate-200 border border-amber-800/60 shadow-xl space-y-1">
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <span>🛡️</span> Cổng kiểm soát độ chín chuyển đổi
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Kỳ báo cáo ({summary?.periodStart} → {summary?.periodEnd}) kết thúc trong vòng 7 ngày gần nhất. Chuyển đổi Meta và hoàn tiền Shopify chưa đóng sổ hoàn toàn. Quyết định scale lớn bị khóa an toàn.
                  </p>
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Đo đúng → So sánh đúng → Phân tích chuyển đổi & Quyết định tăng trưởng
          </p>
        </div>
      </div>

      {/* Control Actions & Store Switcher */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Source status indicator pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              summary?.fromCache ? "bg-amber-400" : "bg-emerald-400 animate-pulse"
            }`}
          />
          <span className="text-slate-300 font-medium">
            {summary?.fromCache ? "Cache 15m" : "Live API"}
          </span>
          {summary?.cachedAt && (
            <span className="text-slate-500 font-mono text-[10px]">
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
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-cyan-300 font-medium focus:outline-none focus:border-cyan-500 cursor-pointer shadow-sm"
        >
          <option value="chillgen">Chillgen Store (USD)</option>
          <option value="jeminise">Jeminise (USD)</option>
          <option value="wrydeco">Wrydeco (USD)</option>
        </select>

        {/* MCP & Codex Button */}
        <button
          type="button"
          onClick={onOpenMcp}
          className="flex items-center gap-1 rounded-lg border border-purple-500/50 bg-purple-950/40 px-2.5 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 hover:border-purple-400 hover:text-white transition cursor-pointer"
          title="Xem thông số kết nối Model Context Protocol (MCP) và Custom GPT"
        >
          <span>🤖</span>
          <span>MCP</span>
        </button>

        {/* Refresh / Sync Button */}
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
            syncing
              ? "border-cyan-700 bg-cyan-950/60 text-cyan-300 cursor-not-allowed opacity-80"
              : "border-cyan-500/60 bg-gradient-to-r from-cyan-950 to-blue-950 text-cyan-200 hover:border-cyan-400 hover:text-white hover:shadow-md hover:shadow-cyan-500/20 active:scale-95"
          }`}
          title="Xóa cache và gọi live Meta & GA4 API ngay lập tức"
        >
          <span className={syncing ? "inline-block animate-spin" : ""}>🔄</span>
          <span>{syncing ? "Đang đồng bộ..." : "Đồng bộ mới"}</span>
        </button>
      </div>
    </header>
  );
}
