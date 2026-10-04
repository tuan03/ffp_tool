import React from "react";

export interface McpModalProps {
  readonly onClose: () => void;
}

export function McpModal({ onClose }: McpModalProps): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-2xl border border-purple-800/60 bg-slate-900 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-500 to-indigo-600 text-xl shadow-lg shadow-purple-500/20">
              🤖
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Model Context Protocol (MCP) & Custom GPT Actions
              </h3>
              <p className="text-xs text-slate-400">
                Kết nối Codex CLI, Claude Desktop, Cursor và OpenAI Custom GPT
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg text-lg cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Endpoint Information */}
          <div className="space-y-2">
            <h4 className="font-semibold text-purple-300 uppercase tracking-wider text-[11px]">
              1. Thông số kết nối Streamable HTTP
            </h4>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-2 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">MCP Stream Endpoint:</span>
                <span className="text-cyan-300 font-bold">/mcp/ads</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">API Protocol Spec:</span>
                <span className="text-purple-300">2024-11-05 (JSON-RPC 2.0)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Authentication:</span>
                <span className="text-emerald-400">Bearer &lt;GATEWAY_AUTH_TOKEN&gt;</span>
              </div>
            </div>
          </div>

          {/* Tools List */}
          <div className="space-y-2">
            <h4 className="font-semibold text-purple-300 uppercase tracking-wider text-[11px]">
              2. Danh mục 20 Công cụ MCP tích hợp sẵn (Tools Catalog)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {[
                { name: "get_store_summary", desc: "Đọc KPI tổng hợp và trạng thái maturity" },
                { name: "get_campaign_hierarchy", desc: "Cây chiến dịch, adset và ads chi tiết" },
                { name: "get_reconciliation_report", desc: "Đối soát 3 bên Meta, GA4 và Shopify" },
                { name: "get_decision_cards", desc: "Danh sách thẻ quyết định và khuyến nghị" },
                { name: "get_ai_strategic_report", desc: "Báo cáo phân tích chuyên sâu từ AI" },
                { name: "get_competitor_intelligence", desc: "Quảng cáo và góc creative đối thủ" },
                { name: "get_creative_briefs", desc: "Danh sách kịch bản creative briefs" },
                { name: "generate_creative_brief", desc: "Sinh kịch bản brief mới từ quyết định" },
                { name: "update_brief_status", desc: "Duyệt hoặc chuyển trạng thái brief" },
                { name: "get_experiments", desc: "Danh sách thử nghiệm A/B đang chạy" },
                { name: "create_experiment", desc: "Khởi tạo thử nghiệm A/B mới" },
                { name: "record_experiment_outcome", desc: "Ghi nhận kết quả Win/Loss thử nghiệm" },
                { name: "propose_guarded_write", desc: "Đề xuất thay đổi ngân sách hoặc tắt ad" },
                { name: "execute_guarded_write", desc: "Thực thi thay đổi có chữ ký kiểm toán" },
                { name: "get_data_health", desc: "Kiểm tra kết nối Meta và GA4" },
                { name: "sync_now", desc: "Xóa cache và kéo live API ngay" },
              ].map((t) => (
                <div key={t.name} className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
                  <div className="font-mono font-bold text-cyan-300 text-[11px]">{t.name}</div>
                  <div className="text-slate-400 text-[10px] mt-0.5">{t.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick config snippet */}
          <div className="space-y-1.5">
            <h4 className="font-semibold text-purple-300 uppercase tracking-wider text-[11px]">
              3. Cấu hình mẫu cho Claude Desktop / Codex CLI
            </h4>
            <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-300 overflow-x-auto">
{`{
  "mcpServers": {
    "ffp-ads": {
      "url": "http://127.0.0.1:3010/mcp/ads",
      "headers": {
        "Authorization": "Bearer <YOUR_GATEWAY_AUTH_TOKEN>"
      }
    }
  }
}`}
            </pre>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-purple-900/60 hover:bg-purple-800 text-purple-200 font-semibold text-xs transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
