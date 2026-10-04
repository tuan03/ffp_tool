import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { persistBrowserActiveStoreId, readActiveStoreId } from "../../../shared/active-store";
import type {
  AdsDataHealth,
  AdsHierarchyCampaign,
  AdsIntelligenceClient,
  AdsStoreSummary,
  CompetitorAdCard,
} from "../types";

export function AdsIntelligencePage({ client }: { readonly client: AdsIntelligenceClient }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const currentStoreId = params.get("storeId") || readActiveStoreId(window.localStorage) || "chillgen";

  const [activeTab, setActiveTab] = useState<"hierarchy" | "funnel" | "competitors" | "health">("hierarchy");
  const [summary, setSummary] = useState<AdsStoreSummary | null>(null);
  const [campaigns, setCampaigns] = useState<readonly AdsHierarchyCampaign[]>([]);
  const [health, setHealth] = useState<AdsDataHealth | null>(null);
  const [competitors, setCompetitors] = useState<readonly CompetitorAdCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let isLive = true;
    setLoading(true);
    persistBrowserActiveStoreId(currentStoreId);

    Promise.all([
      client.getStoreSummary(currentStoreId),
      client.getCampaignHierarchy(currentStoreId),
      client.getDataHealth(currentStoreId),
      client.getCompetitorAds(currentStoreId),
    ])
      .then(([summaryData, campaignsData, healthData, competitorsData]) => {
        if (!isLive) return;
        setSummary(summaryData);
        setCampaigns(campaignsData);
        setHealth(healthData);
        setCompetitors(competitorsData);
        // Expand first campaign by default
        if (campaignsData[0]) {
          setExpandedCampaigns({ [campaignsData[0].id]: true });
        }
      })
      .finally(() => {
        if (isLive) setLoading(false);
      });

    return () => {
      isLive = false;
    };
  }, [client, currentStoreId]);

  const toggleCampaign = (id: string) => {
    setExpandedCampaigns((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex-1 bg-slate-950 p-4 sm:p-6 lg:p-8 text-slate-100 max-w-7xl mx-auto w-full space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-lg shadow-lg shadow-cyan-500/20">
              🎯
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                Ads Intelligence
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                  V1 Performance
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Đo đúng → So sánh đúng → Phân tích chuyển đổi Meta &amp; GA4
              </p>
            </div>
          </div>
        </div>

        {/* Store & Account Context */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-semibold text-slate-200">
              {summary?.accountName || "Chillgen Store"}
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {summary?.accountId || "act_1010295448281555"} ({summary?.currency || "USD"})
            </div>
          </div>
          <select
            value={currentStoreId}
            onChange={(e) => setParams({ storeId: e.target.value })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500 font-medium"
          >
            <option value="chillgen">Chillgen (chillgen.myshopify.com)</option>
            <option value="wrydeco">Wrydeco (wrydeco.myshopify.com)</option>
            <option value="capozen">Capozen (capozen.myshopify.com)</option>
          </select>
        </div>
      </div>

      {/* Warnings & Data Maturity Gate Banner */}
      {summary?.maturity === "PROVISIONAL" && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-4 text-xs text-amber-200 flex items-start gap-3">
          <span className="text-base leading-none">⚠️</span>
          <div className="space-y-1">
            <div className="font-semibold text-amber-300">
              Cổng kiểm soát độ chín dữ liệu (Conversion Maturity Gate: PROVISIONAL)
            </div>
            <div className="text-amber-200/80">
              Kỳ báo cáo ({summary.periodStart} → {summary.periodEnd}) kết thúc trong vòng 7 ngày gần nhất. 
              Các chuyển đổi Meta và hoàn/hủy Shopify chưa đạt độ chín hoàn tất. 
              <strong> Quyết định scale hoặc tắt quảng cáo lớn đang bị khóa an toàn.</strong>
            </div>
          </div>
        </div>
      )}

      {/* Primary KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Chi tiêu (Spend)</span>
          <div className="text-xl font-bold text-slate-100">${summary?.spend || "0.00"}</div>
          <div className="text-[10px] text-slate-500">Kỳ 7 ngày qua</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Purchases (Website)</span>
          <div className="text-xl font-bold text-emerald-400">{summary?.purchases || "0"}</div>
          <div className="text-[10px] text-slate-500">Giá trị: ${summary?.purchaseValue || "0"}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Meta CPA</span>
          <div className="text-xl font-bold text-cyan-300">
            {summary?.cpa ? `$${summary.cpa}` : "—"}
          </div>
          <div className="text-[10px] text-slate-500">Mục tiêu: &lt; $20.00</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Meta ROAS</span>
          <div className="text-xl font-bold text-indigo-400">
            {summary?.roas ? `${summary.roas}×` : "—"}
          </div>
          <div className="text-[10px] text-slate-500">Hòa vốn: 2.50×</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Link CTR</span>
          <div className="text-xl font-bold text-slate-100">{summary?.linkCtr || "0.00%"}</div>
          <div className="text-[10px] text-slate-500">Link Clicks: {summary?.linkClicks || "0"}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Link CPC</span>
          <div className="text-xl font-bold text-slate-100">
            ${summary?.cpc || "0.00"}
          </div>
          <div className="text-[10px] text-slate-500">CPM: ${summary?.cpm || "0.00"}</div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-800 gap-2">
        <button
          onClick={() => setActiveTab("hierarchy")}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px ${
            activeTab === "hierarchy"
              ? "border-cyan-400 text-cyan-300 bg-slate-900/50"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          📊 Phân tích Chiến dịch &amp; Quảng cáo
        </button>

        <button
          onClick={() => setActiveTab("funnel")}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px ${
            activeTab === "funnel"
              ? "border-cyan-400 text-cyan-300 bg-slate-900/50"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          🔍 Phễu &amp; Đối chiếu Nguồn
        </button>

        <button
          onClick={() => setActiveTab("competitors")}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px ${
            activeTab === "competitors"
              ? "border-cyan-400 text-cyan-300 bg-slate-900/50"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          🕵️ Thư viện Đối thủ (Watchlist)
        </button>

        <button
          onClick={() => setActiveTab("health")}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px ${
            activeTab === "health"
              ? "border-cyan-400 text-cyan-300 bg-slate-900/50"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          🛡️ Kết nối &amp; Chất lượng dữ liệu
        </button>
      </div>

      {/* Tab 1: Hierarchy Table */}
      {activeTab === "hierarchy" && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 font-semibold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Đối tượng</th>
                  <th className="py-3 px-3">Trạng thái</th>
                  <th className="py-3 px-3">Ngân sách</th>
                  <th className="py-3 px-3 text-right">Chi tiêu</th>
                  <th className="py-3 px-3 text-right">Đơn hàng</th>
                  <th className="py-3 px-3 text-right">CPA</th>
                  <th className="py-3 px-3 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-500">
                      Đang tải cấu trúc chiến dịch...
                    </td>
                  </tr>
                ) : (
                  campaigns.map((camp) => (
                    <div key={camp.id} style={{ display: "contents" }}>
                      {/* Campaign Row */}
                      <tr className="bg-slate-900/70 hover:bg-slate-850 cursor-pointer font-sans" onClick={() => toggleCampaign(camp.id)}>
                        <td className="py-3 px-4 font-semibold text-slate-100 flex items-center gap-2">
                          <span className="text-slate-500">{expandedCampaigns[camp.id] ? "▼" : "▶"}</span>
                          <span className="text-cyan-400 font-mono text-xs">🏷️ {camp.name}</span>
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            camp.status === "ACTIVE" ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-slate-800 text-slate-400"
                          }`}>
                            {camp.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-300">${camp.dailyBudget}/ngày (Camp)</td>
                        <td className="py-3 px-3 text-right font-bold text-slate-100">${camp.spend}</td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-400">{camp.purchases}</td>
                        <td className="py-3 px-3 text-right text-cyan-300">${camp.cpa}</td>
                        <td className="py-3 px-3 text-right text-indigo-400 font-bold">{camp.roas}×</td>
                      </tr>

                      {/* Nested Adsets & Ads */}
                      {expandedCampaigns[camp.id] &&
                        camp.adsets.map((adset) => (
                          <div key={adset.id} style={{ display: "contents" }}>
                            <tr className="bg-slate-900/30 text-slate-300 hover:bg-slate-850">
                              <td className="py-2.5 px-4 pl-9 flex items-center gap-2">
                                <span className="text-blue-400 text-xs">📁</span>
                                <span className="font-mono text-slate-300">{adset.name}</span>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="text-[10px] text-slate-400">{adset.effectiveStatus}</span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-500">Thừa hưởng</td>
                              <td className="py-2.5 px-3 text-right">${adset.spend}</td>
                              <td className="py-2.5 px-3 text-right text-emerald-400">{adset.purchases}</td>
                              <td className="py-2.5 px-3 text-right text-cyan-300">${adset.cpa}</td>
                              <td className="py-2.5 px-3 text-right text-indigo-400">{adset.roas}×</td>
                            </tr>

                            {adset.ads.map((ad) => (
                              <tr key={ad.id} className="bg-slate-950/60 text-slate-400 hover:bg-slate-900/40 text-[11px]">
                                <td className="py-2 px-4 pl-14 flex items-center gap-2">
                                  <span className="text-slate-600">↳</span>
                                  <span className="font-mono text-slate-400">{ad.name}</span>
                                </td>
                                <td className="py-2 px-3">
                                  <span className="text-[9px] text-slate-500">{ad.effectiveStatus}</span>
                                </td>
                                <td className="py-2 px-3 text-slate-600">—</td>
                                <td className="py-2 px-3 text-right">${ad.spend}</td>
                                <td className="py-2 px-3 text-right text-emerald-400">{ad.purchases}</td>
                                <td className="py-2 px-3 text-right text-cyan-400">${ad.cpa}</td>
                                <td className="py-2 px-3 text-right text-indigo-400">{ad.roas}×</td>
                              </tr>
                            ))}
                          </div>
                        ))}
                    </div>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Funnel & Reconciliation */}
      {activeTab === "funnel" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span>📉</span> Phễu sự kiện Website (Meta Event Volumes)
            </h3>
            <p className="text-xs text-slate-400">
              Lưu ý: Đây là tổng số lượng sự kiện (Event Volume), không phải phễu tuần tự 1 người dùng.
            </p>
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
                <span className="text-slate-400">Impressions (Hiển thị)</span>
                <span className="font-mono font-bold text-slate-200">{summary?.impressions}</span>
              </div>
              <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
                <span className="text-slate-400">Link Clicks (Nhấp liên kết)</span>
                <span className="font-mono font-bold text-slate-200">{summary?.linkClicks} (CTR: {summary?.linkCtr})</span>
              </div>
              <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
                <span className="text-slate-400">Landing Page Views (Xem trang đích)</span>
                <span className="font-mono font-bold text-slate-200">{summary?.lpv}</span>
              </div>
              <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
                <span className="text-slate-400">Add to Cart (Thêm giỏ hàng)</span>
                <span className="font-mono font-bold text-amber-300">{summary?.atc}</span>
              </div>
              <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
                <span className="text-slate-400">Initiate Checkout (Bắt đầu thanh toán)</span>
                <span className="font-mono font-bold text-indigo-300">{summary?.checkout}</span>
              </div>
              <div className="flex items-center justify-between text-xs pb-1">
                <span className="text-emerald-400 font-semibold">Purchases (Đơn hàng thành công)</span>
                <span className="font-mono font-bold text-emerald-400">{summary?.purchases}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span>⚖️</span> Đối chiếu ba nguồn (Reconciliation View)
            </h3>
            <div className="space-y-3 pt-2">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-cyan-400 font-medium">Meta Attributed (7-day click, 1-day view)</span>
                  <span className="font-mono font-bold text-slate-200">{summary?.purchases} đơn (${summary?.purchaseValue})</span>
                </div>
                <p className="text-[10px] text-slate-400">
                  Mô hình gán công thuật toán pixel, bao gồm cả view-through.
                </p>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-400 font-medium">GA4 Observed (Session UTM Paid Social)</span>
                  <span className="font-mono font-bold text-slate-200">24 giao dịch ($1,560)</span>
                </div>
                <p className="text-[10px] text-slate-400">
                  Dữ liệu ghi nhận trực tiếp theo phiên truy cập web có gắn UTM.
                </p>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-purple-400 font-medium">Shopify Net Orders (Thực tế trừ refund)</span>
                  <span className="font-mono font-bold text-slate-200">27 đơn hợp lệ ($1,720)</span>
                </div>
                <p className="text-[10px] text-slate-400">
                  Dòng tiền và đơn hàng thực tế ghi nhận trên trang quản trị Shopify.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Competitor Watchlist */}
      {activeTab === "competitors" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Provider: <strong className="text-cyan-400">ScrapeCreators</strong> (Còn lại 4.999 credits)
            </div>
            <div className="text-xs text-slate-500">
              Watchlist: 3 đối thủ ngành Blanket / Home Decor
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {competitors.map((ad) => (
              <div key={ad.archiveId} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">{ad.pageName}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                    {ad.status}
                  </span>
                </div>
                <div className="aspect-video w-full rounded-lg bg-slate-950 overflow-hidden relative border border-slate-800">
                  <img src={ad.thumbnailUrl} alt={ad.headline} className="w-full h-full object-cover" />
                  <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 text-[10px] font-bold text-white uppercase">
                    {ad.mediaType}
                  </span>
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-slate-100 line-clamp-1">{ad.headline}</h4>
                  <p className="text-[11px] text-slate-400 line-clamp-2">{ad.caption}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[10px] text-slate-500">
                  <span>Khảo sát: {ad.inspectionLevel}</span>
                  <span>CTA: {ad.cta}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Data Health & Connections */}
      {activeTab === "health" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
              <span>🔵</span> Meta Marketing API
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Trạng thái</span>
                <span className="text-emerald-400 font-bold">● ĐÃ KẾT NỐI (Verified)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Tài khoản</span>
                <span className="font-mono text-slate-200">{health?.metaConnection.accountName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Ad Account ID</span>
                <span className="font-mono text-slate-200">{health?.metaConnection.accountId}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Proxy</span>
                <span className="font-mono text-slate-200">{health?.metaConnection.proxyProfile}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Graph API Version</span>
                <span className="font-mono text-cyan-300">{health?.metaConnection.apiVersion}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <span>📊</span> Google Analytics 4 (GA4)
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Trạng thái</span>
                <span className="text-emerald-400 font-bold">● ĐÃ KẾT NỐI (Verified)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Numeric Property ID</span>
                <span className="font-mono text-slate-200">{health?.ga4Connection.propertyId}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Service Account Credential</span>
                <span className="font-mono text-slate-200">{health?.ga4Connection.serviceAccount}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">API Scope</span>
                <span className="font-mono text-slate-300">analytics.readonly</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
