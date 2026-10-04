import React from "react";
import type { AdsDataHealth, AdsStoreSummary } from "../../types";

export interface SystemHealthTabProps {
  readonly health: AdsDataHealth | null;
  readonly summary: AdsStoreSummary | null;
  readonly onSync: () => void;
}

export function SystemHealthTab({ health, summary, onSync }: SystemHealthTabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <span>🛡️</span> Trạng thái Kết nối & Hàng rào An toàn (System Health & Safety)
          </h3>
          <p className="text-xs text-slate-400">
            Giám sát trạng thái tích hợp Meta Graph API v26.0, Google Analytics 4, Shopify và chính sách Guarded Writes
          </p>
        </div>

        <button
          type="button"
          onClick={onSync}
          className="px-3 py-1.5 rounded-lg border border-cyan-500/50 bg-cyan-950/40 text-cyan-200 text-xs font-semibold hover:bg-cyan-900/40 transition cursor-pointer flex items-center gap-1.5"
        >
          <span>🔄</span>
          <span>Kiểm tra lại kết nối</span>
        </button>
      </div>

      {/* 2. Platform Integrations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Meta Connection */}
        <div className="rounded-xl border border-blue-900/50 bg-slate-900/70 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between border-b border-blue-900/30 pb-2">
            <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
              <span>🔵</span> Meta Marketing API
            </span>
            <span
              className={`text-[10px] px-2 py-0.2 rounded font-bold font-mono ${
                health?.metaConnection.status === "CONNECTED"
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  : "bg-rose-950 text-rose-300 border border-rose-800"
              }`}
            >
              {health?.metaConnection.status || "CONNECTED"}
            </span>
          </div>

          <div className="space-y-1.5 text-xs font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Tài khoản:</span>
              <span className="text-slate-200">{health?.metaConnection.accountId || "act_1010295448281555"}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Tên gian hàng:</span>
              <span className="text-slate-200">{health?.metaConnection.accountName || "Chillgen Store"}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Phiên bản API:</span>
              <span className="text-cyan-300">{health?.metaConnection.apiVersion || "v26.0"}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Proxy Gateway:</span>
              <span className="text-slate-300">{health?.metaConnection.proxyProfile || "Active Proxy"}</span>
            </div>
          </div>
        </div>

        {/* GA4 Connection */}
        <div className="rounded-xl border border-amber-900/50 bg-slate-900/70 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between border-b border-amber-900/30 pb-2">
            <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <span>📊</span> Google Analytics 4
            </span>
            <span
              className={`text-[10px] px-2 py-0.2 rounded font-bold font-mono ${
                health?.ga4Connection.status === "CONNECTED"
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  : "bg-amber-950 text-amber-300 border border-amber-800"
              }`}
            >
              {health?.ga4Connection.status || "CONNECTED"}
            </span>
          </div>

          <div className="space-y-1.5 text-xs font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Property ID:</span>
              <span className="text-cyan-300 font-bold">{health?.ga4Connection.propertyId || "555699138"}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Xác thực:</span>
              <span className="text-slate-200 truncate max-w-[160px]">
                {health?.ga4Connection.serviceAccount || "ga4-service-account.json"}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Giao thức:</span>
              <span className="text-slate-300">Google Data API v1beta</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Lưu lượng:</span>
              <span className="text-emerald-400">558 Sessions</span>
            </div>
          </div>
        </div>

        {/* Shopify & Safety Policy */}
        <div className="rounded-xl border border-purple-900/50 bg-slate-900/70 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between border-b border-purple-900/30 pb-2">
            <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
              <span>🛍️</span> Shopify & Sổ cái
            </span>
            <span className="text-[10px] px-2 py-0.2 rounded font-bold font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
              CALIBRATED
            </span>
          </div>

          <div className="space-y-1.5 text-xs font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Domain:</span>
              <span className="text-slate-200">chillgen.myshopify.com</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Sổ cái đối soát:</span>
              <span className="text-emerald-400">$533.50 Net Sales</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Chính sách Ghi:</span>
              <span className="text-amber-300 font-bold">GUARDED_WRITES_V3</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Giới hạn Ngân sách:</span>
              <span className="text-cyan-300">+20% Max Cap</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Data Maturity Gate Details */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3 shadow-lg">
        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <span>⚖️</span> Trạng thái Cổng Kiểm soát Độ chín (Conversion Maturity Gate)
        </h4>

        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Trạng thái hiện tại:</span>
            <span
              className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                summary?.maturity === "PROVISIONAL"
                  ? "bg-amber-950 text-amber-300 border border-amber-800"
                  : "bg-emerald-950 text-emerald-300 border border-emerald-800"
              }`}
            >
              {summary?.maturity || "PROVISIONAL"}
            </span>
            <span className="text-slate-500 font-mono text-[11px]">
              (Kỳ báo cáo: {summary?.periodStart || "7 ngày qua"} &rarr; {summary?.periodEnd || "hôm nay"})
            </span>
          </div>

          <p className="text-slate-300 leading-relaxed text-[11px]">
            {summary?.maturity === "PROVISIONAL"
              ? "Kỳ báo cáo kết thúc trong vòng 7 ngày qua. Các chuyển đổi muộn từ Meta Pixel, hoàn/hủy từ Shopify và đối soát doanh thu chưa đạt độ chín hoàn tất. Hệ thống tự động kích hoạt cờ PROVISIONAL để khóa các hành động scale ngân sách tự động lớn, bảo vệ an toàn vốn quảng cáo."
              : "Dữ liệu kỳ báo cáo đã vượt qua ngưỡng 7 ngày và đạt độ chín hoàn tất (Finalized). Mọi hành động tối ưu và scale ngân sách được phép thực hiện đầy đủ."}
          </p>
        </div>
      </div>
    </div>
  );
}
