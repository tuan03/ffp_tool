import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { persistBrowserActiveStoreId, readActiveStoreId } from "../../../shared/active-store";
import type {
  AdsDataHealth,
  AdsHierarchyCampaign,
  AdsIntelligenceClient,
  AdsReconciliationReport,
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
  const [reconciliation, setReconciliation] = useState<AdsReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({});

  const handleSync = async () => {
    if (!client.syncNow || syncing) return;
    setSyncing(true);
    setSyncMessage("Đang gọi live Meta Graph API & GA4 Data API...");
    try {
      const res = await client.syncNow(currentStoreId);
      const [summaryData, campaignsData, healthData, reconData] = await Promise.all([
        client.getStoreSummary(currentStoreId),
        client.getCampaignHierarchy(currentStoreId),
        client.getDataHealth(currentStoreId),
        client.getReconciliationReport ? client.getReconciliationReport(currentStoreId) : Promise.resolve(null),
      ]);
      setSummary(summaryData);
      setCampaigns(campaignsData);
      setHealth(healthData);
      if (reconData) setReconciliation(reconData);
      setSyncMessage(res.message);
      setTimeout(() => setSyncMessage(null), 6000);
    } catch {
      setSyncMessage("Đồng bộ thất bại, vui lòng kiểm tra kết nối API.");
      setTimeout(() => setSyncMessage(null), 6000);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    let isLive = true;
    setLoading(true);
    persistBrowserActiveStoreId(currentStoreId);

    Promise.all([
      client.getStoreSummary(currentStoreId),
      client.getCampaignHierarchy(currentStoreId),
      client.getDataHealth(currentStoreId),
      client.getCompetitorAds(currentStoreId),
      client.getReconciliationReport ? client.getReconciliationReport(currentStoreId) : Promise.resolve(null),
    ])
      .then(([summaryData, campaignsData, healthData, competitorsData, reconData]) => {
        if (!isLive) return;
        setSummary(summaryData);
        setCampaigns(campaignsData);
        setHealth(healthData);
        setCompetitors(competitorsData);
        if (reconData) setReconciliation(reconData);
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
            <option value="jeminise">Jemine / Jeminise (jeminise.com)</option>
            <option value="wrydeco">Wrydeco (wrydeco.myshopify.com)</option>
          </select>

          <button
            onClick={handleSync}
            disabled={syncing}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
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
      </div>

      {/* Live / Cache Source Status Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs shadow-sm">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${summary?.fromCache ? "bg-amber-400 ring-2 ring-amber-400/20" : "bg-emerald-400 animate-pulse ring-2 ring-emerald-400/20"}`} />
          <span className="text-slate-300">
            Nguồn dữ liệu:{" "}
            <strong className={summary?.fromCache ? "text-amber-300 font-semibold" : "text-emerald-300 font-semibold"}>
              {summary?.fromCache ? "⚡ Bộ nhớ đệm Gateway (Tiết kiệm Token & Quota API)" : "🟢 Live Meta Graph API v26.0 & GA4"}
            </strong>
          </span>
          {summary?.cachedAt && (
            <span className="text-slate-500 text-[11px] font-mono">
              [Cập nhật: {new Date(summary.cachedAt).toLocaleTimeString("vi-VN")}]
            </span>
          )}
        </div>
        {syncMessage ? (
          <div className="text-xs text-cyan-300 font-medium animate-pulse">{syncMessage}</div>
        ) : (
          <div className="text-slate-400 text-[11px]">
            {summary?.fromCache ? "Cache TTL: 15 phút (Bấm \"Đồng bộ mới\" để gọi live)" : "Số liệu trực tiếp từ tài khoản quảng cáo"}
          </div>
        )}
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
        <div className="space-y-6">
          {/* Commerce Financial Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🛍️</span> Doanh thu thuần
              </span>
              <div className="text-xl font-bold text-slate-100">
                ${reconciliation?.shopify.netSales || "0.00"}
              </div>
              <div className="text-[10px] text-slate-400">
                Gross: ${reconciliation?.shopify.grossSales || "0.00"} (Refund: -${reconciliation?.shopify.totalRefunds || "0.00"})
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>📦</span> Đơn thực tế
              </span>
              <div className="text-xl font-bold text-purple-400">
                {reconciliation?.shopify.totalOrders ?? 0} đơn
              </div>
              <div className="text-[10px] text-slate-400">
                AOV: ${reconciliation?.shopify.averageOrderValue || "0.00"} / đơn
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🎯</span> MER (Hiệu quả)
              </span>
              <div className="text-xl font-bold text-cyan-400">
                {reconciliation?.shopify.mer ? `${reconciliation.shopify.mer}×` : "—"}
              </div>
              <div className="text-[10px]">
                {reconciliation?.shopify.mer && Number(reconciliation.shopify.mer) >= 2.5 ? (
                  <span className="text-emerald-400 font-semibold">🟢 Lãi ròng (&ge; 2.50×)</span>
                ) : (
                  <span className="text-amber-400 font-semibold">⚠️ Dưới hòa vốn (&lt; 2.50×)</span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>💰</span> Blended CPA
              </span>
              <div className="text-xl font-bold text-indigo-300">
                {reconciliation?.shopify.blendedCpa ? `$${reconciliation.shopify.blendedCpa}` : "—"}
              </div>
              <div className="text-[10px] text-slate-400">
                Chi tiêu / Đơn Shopify thực tế
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>📉</span> Rơi rụng Clicks
              </span>
              <div className="text-xl font-bold text-amber-400">
                {reconciliation?.gaps.clickDropPct || "0.0%"}
              </div>
              <div className="text-[10px] text-slate-400">
                {reconciliation?.meta.linkClicks || summary?.linkClicks || 0} clicks &rarr; {reconciliation?.ga4.sessions ?? 0} sessions
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>⚖️</span> Lệch đơn Pixel
              </span>
              <div className="text-xl font-bold text-slate-100">
                {reconciliation?.gaps.purchaseDiscrepancy !== undefined
                  ? reconciliation.gaps.purchaseDiscrepancy > 0
                    ? `+${reconciliation.gaps.purchaseDiscrepancy}`
                    : `${reconciliation.gaps.purchaseDiscrepancy}`
                  : "0"}{" "}
                đơn
              </div>
              <div className="text-[10px] text-slate-400">
                Pixel: {reconciliation?.meta.purchases || summary?.purchases || 0} vs Shop: {reconciliation?.shopify.totalOrders ?? 0}
              </div>
            </div>
          </div>

          {/* Main 2-Column: Funnel Analytics & Reconciliation Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Website Event Funnel */}
            <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <span>📉</span> Phễu sự kiện Website (Meta Event Volumes)
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  Đo lường volume sự kiện pixel &amp; tỷ lệ chuyển đổi từng tầng phễu.
                </p>
              </div>

              <div className="space-y-3.5 pt-1">
                {/* Step 1: Impressions */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">1. Impressions (Hiển thị)</span>
                    <span className="font-mono font-bold text-slate-200">{summary?.impressions || "0"}</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div className="bg-slate-400 h-1.5 rounded-full w-full" />
                  </div>
                </div>

                {/* Step 2: Link Clicks */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">2. Link Clicks (Nhấp liên kết)</span>
                    <span className="font-mono font-bold text-slate-200">
                      {summary?.linkClicks || "0"}{" "}
                      <span className="text-[10px] text-cyan-400 font-sans font-medium">({summary?.linkCtr || "0.00%"})</span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div className="bg-cyan-500 h-1.5 rounded-full w-[85%]" />
                  </div>
                </div>

                {/* Step 3: Landing Page Views */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">3. Landing Page Views (Vào web)</span>
                    <span className="font-mono font-bold text-slate-200">
                      {summary?.lpv || "0"}{" "}
                      {Number(summary?.linkClicks) > 0 && (
                        <span className="text-[10px] text-slate-500 font-sans">
                          ({((Number(summary?.lpv || 0) / Number(summary?.linkClicks || 1)) * 100).toFixed(0)}% click)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full w-[70%]" />
                  </div>
                </div>

                {/* Step 4: Add to Cart */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">4. Add to Cart (Thêm giỏ hàng)</span>
                    <span className="font-mono font-bold text-amber-300">
                      {summary?.atc || "0"}{" "}
                      {Number(summary?.lpv) > 0 && (
                        <span className="text-[10px] text-amber-400/80 font-sans font-medium">
                          ({((Number(summary?.atc || 0) / Number(summary?.lpv || 1)) * 100).toFixed(1)}% LPV)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div className="bg-amber-500 h-1.5 rounded-full w-[45%]" />
                  </div>
                </div>

                {/* Step 5: Initiate Checkout */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">5. Checkout (Thanh toán)</span>
                    <span className="font-mono font-bold text-indigo-300">
                      {summary?.checkout || "0"}{" "}
                      {Number(summary?.atc) > 0 && (
                        <span className="text-[10px] text-indigo-400/80 font-sans font-medium">
                          ({((Number(summary?.checkout || 0) / Number(summary?.atc || 1)) * 100).toFixed(1)}% ATC)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div className="bg-indigo-500 h-1.5 rounded-full w-[30%]" />
                  </div>
                </div>

                {/* Step 6: Purchases */}
                <div className="space-y-1 pt-1 border-t border-slate-800">
                  <div className="flex justify-between text-xs">
                    <span className="text-emerald-400 font-semibold">6. Purchases (Đơn hoàn tất)</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {summary?.purchases || "0"}{" "}
                      {Number(summary?.checkout) > 0 && (
                        <span className="text-[10px] text-emerald-300 font-sans font-medium">
                          ({((Number(summary?.purchases || 0) / Number(summary?.checkout || 1)) * 100).toFixed(1)}% Check)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div className="bg-emerald-500 h-1.5 rounded-full w-[20%]" />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Three-Way Reconciliation Matrix Table */}
            <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <span>⚖️</span> Ma trận Đối chiếu Ba nguồn (Three-Way Reconciliation Matrix)
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    So sánh thực tế: <strong>Meta Pixel (Gán công)</strong> vs <strong>GA4 Data API (Quan sát)</strong> vs <strong>Shopify (Dòng tiền thực thu)</strong>.
                  </p>
                </div>
                <div className="text-[11px] px-2.5 py-1 rounded bg-slate-800/80 text-slate-300 font-mono self-start sm:self-auto">
                  Nguồn: {reconciliation?.shopify.source || "Shopify Store"}
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Chỉ số đo lường</th>
                      <th className="py-2.5 px-3 text-cyan-400">🟦 Meta Pixel</th>
                      <th className="py-2.5 px-3 text-emerald-400">🟩 GA4 Data API</th>
                      <th className="py-2.5 px-3 text-purple-400">🟪 Shopify Settled</th>
                      <th className="py-2.5 px-3 text-amber-300">⚖️ Phân tích &amp; Chênh lệch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono text-[11px]">
                    {/* Row 1: Traffic */}
                    <tr className="hover:bg-slate-850">
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-200">
                        Lưu lượng (Traffic)
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        {reconciliation?.meta.linkClicks || summary?.linkClicks || "0"} clicks
                      </td>
                      <td className="py-2.5 px-3 text-emerald-300 font-bold">
                        {reconciliation?.ga4.sessions ?? 0} sessions
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">—</td>
                      <td className="py-2.5 px-3 font-sans text-[11px]">
                        <span className="text-amber-400 font-bold">Rơi rụng {reconciliation?.gaps.clickDropPct || "0.0%"}</span>
                        <div className="text-[10px] text-slate-400 font-normal">Do độ trễ tải trang hoặc cookie consent</div>
                      </td>
                    </tr>

                    {/* Row 2: Orders */}
                    <tr className="hover:bg-slate-850">
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-200">
                        Đơn hàng (Orders)
                      </td>
                      <td className="py-2.5 px-3 text-cyan-300 font-bold">
                        {reconciliation?.meta.purchases || summary?.purchases || "0"} đơn
                        <div className="text-[9px] text-slate-500 font-sans font-normal">7-day click, 1-day view</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {reconciliation?.ga4.ecommercePurchases ?? 0} đơn
                        <div className="text-[9px] text-slate-500 font-sans font-normal">UTM paid-social</div>
                      </td>
                      <td className="py-2.5 px-3 text-purple-300 font-bold">
                        {reconciliation?.shopify.totalOrders ?? 0} đơn
                        <div className="text-[9px] text-slate-500 font-sans font-normal">Thực tế đã thanh toán</div>
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[11px]">
                        {reconciliation?.gaps.purchaseDiscrepancy !== undefined ? (
                          reconciliation.gaps.purchaseDiscrepancy === 0 ? (
                            <span className="text-emerald-400 font-semibold">Khớp 100% (0 lệch)</span>
                          ) : reconciliation.gaps.purchaseDiscrepancy > 0 ? (
                            <span className="text-cyan-400 font-semibold">
                              Meta gán dư +{reconciliation.gaps.purchaseDiscrepancy} đơn (View-through)
                            </span>
                          ) : (
                            <span className="text-purple-400 font-semibold">
                              Shopify nhiều hơn {Math.abs(reconciliation.gaps.purchaseDiscrepancy)} đơn (Direct/SEO)
                            </span>
                          )
                        ) : (
                          "0"
                        )}
                      </td>
                    </tr>

                    {/* Row 3: Revenue */}
                    <tr className="hover:bg-slate-850">
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-200">
                        Doanh thu (Revenue)
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        ${reconciliation?.meta.purchaseValue || summary?.purchaseValue || "0.00"}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        ${reconciliation?.ga4.purchaseRevenue ? reconciliation.ga4.purchaseRevenue.toFixed(2) : "0.00"}
                      </td>
                      <td className="py-2.5 px-3 text-emerald-400 font-bold">
                        ${reconciliation?.shopify.netSales || "0.00"}
                        <div className="text-[9px] text-slate-500 font-sans font-normal">Đã trừ tiền hoàn trả</div>
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[11px]">
                        <span className="text-slate-300 font-mono">
                          Lệch:{" "}
                          {reconciliation?.gaps.revenueDiscrepancy
                            ? Number(reconciliation.gaps.revenueDiscrepancy) >= 0
                              ? `+$${reconciliation.gaps.revenueDiscrepancy}`
                              : `-$${Math.abs(Number(reconciliation.gaps.revenueDiscrepancy))}`
                            : "$0.00"}
                        </span>
                      </td>
                    </tr>

                    {/* Row 4: CPA */}
                    <tr className="hover:bg-slate-850">
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-200">
                        Chi phí / Đơn (CPA)
                      </td>
                      <td className="py-2.5 px-3 text-cyan-300 font-bold">
                        {reconciliation?.meta.cpa ? `$${reconciliation.meta.cpa}` : "—"}
                        <div className="text-[9px] text-slate-500 font-sans font-normal">Meta Pixel CPA</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">—</td>
                      <td className="py-2.5 px-3 text-indigo-400 font-bold">
                        {reconciliation?.shopify.blendedCpa ? `$${reconciliation.shopify.blendedCpa}` : "—"}
                        <div className="text-[9px] text-slate-500 font-sans font-normal">Blended CPA thực</div>
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[11px] text-slate-400">
                        Chi phí ad thực tế để có 1 đơn hàng Shopify về túi
                      </td>
                    </tr>

                    {/* Row 5: Efficiency (ROAS & MER) */}
                    <tr className="hover:bg-slate-850 bg-slate-900/30">
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-200">
                        Hiệu quả tổng thể
                      </td>
                      <td className="py-2.5 px-3 text-indigo-400 font-bold">
                        {reconciliation?.meta.roas ? `${reconciliation.meta.roas}×` : "—"}
                        <div className="text-[9px] text-slate-500 font-sans font-normal">Pixel ROAS</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">—</td>
                      <td className="py-2.5 px-3 text-cyan-400 font-bold">
                        {reconciliation?.shopify.mer ? `${reconciliation.shopify.mer}×` : "—"}
                        <div className="text-[9px] text-slate-500 font-sans font-normal">MER (Net Sales / Spend)</div>
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[11px]">
                        {reconciliation?.shopify.mer && Number(reconciliation.shopify.mer) >= 2.5 ? (
                          <span className="text-emerald-400 font-semibold">Vượt ngưỡng hòa vốn (2.50×)</span>
                        ) : (
                          <span className="text-amber-400 font-semibold">Chưa đạt ngưỡng hòa vốn (2.50×)</span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Dynamic Audit Recommendations */}
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <span>💡</span> Nhận định &amp; Khuyến nghị Kiểm toán Đối chiếu:
                </div>
                <div className="space-y-2">
                  {reconciliation?.gaps.notes && reconciliation.gaps.notes.length > 0 ? (
                    reconciliation.gaps.notes.map((note, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-xs text-slate-300 flex items-start gap-2.5"
                      >
                        <span className="text-cyan-400 text-sm leading-none mt-0.5">📌</span>
                        <div className="flex-1">{note}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-500 italic">Đang phân tích chênh lệch đối chiếu...</div>
                  )}
                </div>
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
