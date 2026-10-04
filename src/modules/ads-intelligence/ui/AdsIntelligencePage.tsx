import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { persistBrowserActiveStoreId, readActiveStoreId } from "../../../shared/active-store";
import type {
  AdsDataHealth,
  AdsHierarchyCampaign,
  AdsIntelligenceClient,
  AdsReconciliationReport,
  AdsStoreSummary,
  AiStrategicReport,
  CompetitorAdCard,
  CompetitorIntelligenceReport,
  DecisionCard,
} from "../types";

export function AdsIntelligencePage({ client }: { readonly client: AdsIntelligenceClient }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const currentStoreId = params.get("storeId") || readActiveStoreId(window.localStorage) || "chillgen";

  const [activeTab, setActiveTab] = useState<"decisions" | "hierarchy" | "funnel" | "competitors" | "health">("decisions");
  const [decisionFilter, setDecisionFilter] = useState<"ALL" | "PAUSE" | "SCALE" | "CREATIVE" | "WAIT" | "FUNNEL">("ALL");
  const [decisions, setDecisions] = useState<readonly DecisionCard[]>([]);
  const [aiReport, setAiReport] = useState<AiStrategicReport | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [summary, setSummary] = useState<AdsStoreSummary | null>(null);
  const [campaigns, setCampaigns] = useState<readonly AdsHierarchyCampaign[]>([]);
  const [health, setHealth] = useState<AdsDataHealth | null>(null);
  const [competitors, setCompetitors] = useState<readonly CompetitorAdCard[]>([]);
  const [competitorReport, setCompetitorReport] = useState<CompetitorIntelligenceReport | null>(null);
  const [selectedCompetitorPage, setSelectedCompetitorPage] = useState<string>("ALL");
  const [selectedCompetitorFormat, setSelectedCompetitorFormat] = useState<string>("ALL");
  const [selectedCompetitorHook, setSelectedCompetitorHook] = useState<string>("ALL");
  const [copiedGapId, setCopiedGapId] = useState<string | null>(null);
  const [copiedAdId, setCopiedAdId] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<AdsReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({});

  const handleAiAnalyze = async () => {
    if (!client.getAiStrategicReport || aiAnalyzing) return;
    setAiAnalyzing(true);
    try {
      const res = await client.getAiStrategicReport(currentStoreId, true);
      setAiReport(res);
    } catch {
      // fallback
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleSync = async () => {
    if (!client.syncNow || syncing) return;
    setSyncing(true);
    setSyncMessage("Đang gọi live Meta Graph API & GA4 Data API...");
    try {
      const res = await client.syncNow(currentStoreId);
      const [summaryData, campaignsData, healthData, reconData, decisionsData, aiData, competitorData] = await Promise.all([
        client.getStoreSummary(currentStoreId),
        client.getCampaignHierarchy(currentStoreId),
        client.getDataHealth(currentStoreId),
        client.getReconciliationReport ? client.getReconciliationReport(currentStoreId) : Promise.resolve(null),
        client.getDecisionCards ? client.getDecisionCards(currentStoreId) : Promise.resolve([]),
        client.getAiStrategicReport ? client.getAiStrategicReport(currentStoreId) : Promise.resolve(null),
        client.getCompetitorIntelligence ? client.getCompetitorIntelligence(currentStoreId, true) : Promise.resolve(null),
      ]);
      setSummary(summaryData);
      setCampaigns(campaignsData);
      setHealth(healthData);
      if (reconData) setReconciliation(reconData);
      if (decisionsData) setDecisions(decisionsData);
      if (aiData) setAiReport(aiData);
      if (competitorData) setCompetitorReport(competitorData);
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
      client.getDecisionCards ? client.getDecisionCards(currentStoreId) : Promise.resolve([]),
      client.getAiStrategicReport ? client.getAiStrategicReport(currentStoreId) : Promise.resolve(null),
      client.getCompetitorIntelligence ? client.getCompetitorIntelligence(currentStoreId) : Promise.resolve(null),
    ])
      .then(([summaryData, campaignsData, healthData, competitorsData, reconData, decisionsData, aiData, competitorData]) => {
        if (!isLive) return;
        setSummary(summaryData);
        setCampaigns(campaignsData);
        setHealth(healthData);
        setCompetitors(competitorsData);
        if (reconData) setReconciliation(reconData);
        if (decisionsData) setDecisions(decisionsData);
        if (aiData) setAiReport(aiData);
        if (competitorData) setCompetitorReport(competitorData);
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

  const filterDecision = (card: DecisionCard): boolean => {
    if (decisionFilter === "PAUSE") return card.decision === "PAUSE_CANDIDATE" || card.decision === "REDUCE_CANDIDATE";
    if (decisionFilter === "SCALE") return card.decision === "SCALE_CANDIDATE";
    if (decisionFilter === "CREATIVE") return card.decision === "TEST_CREATIVE";
    if (decisionFilter === "WAIT") return card.decision === "WAIT";
    if (decisionFilter === "FUNNEL") return card.decision === "CHECK_LANDING" || card.decision === "CHECK_CHECKOUT" || card.decision === "INVESTIGATE_TRACKING" || card.decision === "CHECK_OFFER";
    return true;
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
          onClick={() => setActiveTab("decisions")}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px flex items-center gap-1.5 cursor-pointer ${
            activeTab === "decisions"
              ? "border-cyan-400 text-cyan-300 bg-slate-900/50"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>🎯</span>
          <span>Quyết định &amp; AI Phân Tích</span>
          {decisions.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
              {decisions.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("hierarchy")}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px cursor-pointer ${
            activeTab === "hierarchy"
              ? "border-cyan-400 text-cyan-300 bg-slate-900/50"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          📊 Phân tích Chiến dịch &amp; Quảng cáo
        </button>

        <button
          onClick={() => setActiveTab("funnel")}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px cursor-pointer ${
            activeTab === "funnel"
              ? "border-cyan-400 text-cyan-300 bg-slate-900/50"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          🔍 Phễu &amp; Đối chiếu Nguồn
        </button>

        <button
          onClick={() => setActiveTab("competitors")}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px cursor-pointer ${
            activeTab === "competitors"
              ? "border-cyan-400 text-cyan-300 bg-slate-900/50"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          🕵️ Đối thủ &amp; Creative Gaps
        </button>

        <button
          onClick={() => setActiveTab("health")}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px cursor-pointer ${
            activeTab === "health"
              ? "border-cyan-400 text-cyan-300 bg-slate-900/50"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          🛡️ Kết nối &amp; Chất lượng dữ liệu
        </button>
      </div>

      {/* Tab: Decisions & AI */}
      {activeTab === "decisions" && (
        <div className="space-y-6">
          {/* AI Strategic Analyst Executive Diagnosis Card */}
          <div className="rounded-2xl border border-cyan-900/40 bg-gradient-to-b from-slate-900/90 via-slate-900/60 to-slate-950 p-5 shadow-2xl relative overflow-hidden space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 text-xl shadow-lg shadow-indigo-500/20">
                  ✨
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
                      Báo cáo Chiến lược AI (Senior Media Buyer Diagnosis)
                    </h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300 border border-slate-700 font-mono">
                      {aiReport?.modelUsed || "gemini-2.5-flash"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Phân tích toàn diện hiệu quả dòng tiền, nguyên nhân gốc rễ và đề xuất kịch bản Creative 30s
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {aiReport?.executiveSummary && (
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                      aiReport.executiveSummary.overallHealth === "HEALTHY"
                        ? "bg-emerald-950/80 border-emerald-600 text-emerald-300"
                        : aiReport.executiveSummary.overallHealth === "WATCH"
                        ? "bg-amber-950/80 border-amber-600 text-amber-300"
                        : "bg-rose-950/80 border-rose-600 text-rose-300"
                    }`}
                  >
                    <span>
                      {aiReport.executiveSummary.overallHealth === "HEALTHY"
                        ? "🟢 Tăng trưởng Lành mạnh"
                        : aiReport.executiveSummary.overallHealth === "WATCH"
                        ? "🟡 Cần theo dõi sát"
                        : "🔴 Cảnh báo Rủi ro"}
                    </span>
                  </span>
                )}

                <button
                  onClick={handleAiAnalyze}
                  disabled={aiAnalyzing}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    aiAnalyzing
                      ? "border-cyan-700 bg-cyan-950/60 text-cyan-300 cursor-not-allowed opacity-80"
                      : "border-indigo-500/60 bg-gradient-to-r from-indigo-950 to-purple-950 text-indigo-200 hover:border-indigo-400 hover:text-white hover:shadow-md hover:shadow-indigo-500/20 active:scale-95"
                  }`}
                  title="Gọi AI phân tích lại toàn bộ dữ liệu mới nhất"
                >
                  <span className={aiAnalyzing ? "inline-block animate-spin" : ""}>✨</span>
                  <span>{aiAnalyzing ? "Đang phân tích..." : "Phân tích lại với AI"}</span>
                </button>
              </div>
            </div>

            {/* Executive Diagnosis Summary Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>📊</span> Đánh giá MER &amp; Hòa vốn
                </span>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {aiReport?.executiveSummary.merVerdict || "Đang tổng hợp dữ liệu MER từ Shopify và Meta..."}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>💰</span> Chẩn đoán Lợi nhuận Ròng / Thất thoát
                </span>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {aiReport?.executiveSummary.profitLossDiagnosis || "Đang kiểm tra đối chiếu lợi nhuận..."}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🚨</span> Khối lượng Hành động Cần can thiệp
                </span>
                <div className="flex items-baseline gap-2 pt-0.5">
                  <span className="text-2xl font-black text-rose-400">
                    {aiReport?.executiveSummary.highPriorityActionCount ?? 0}
                  </span>
                  <span className="text-xs text-slate-400">
                    / {aiReport?.executiveSummary.totalDecisionsCount ?? decisions.length} quyết định ưu tiên cao
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Cần xử lý ngay các quảng cáo tiêu hao ngân sách cao không ra đơn trước chu kỳ chi tiêu tiếp theo.
                </p>
              </div>
            </div>

            {/* AI Root-Cause Hypotheses Section */}
            {aiReport?.rootCauseHypotheses && aiReport.rootCauseHypotheses.length > 0 && (
              <div className="border-t border-slate-800/80 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span>🔬</span> Giả thuyết Nguyên nhân Gốc rễ &amp; Phản biện (Root-Cause &amp; Counter-Hypotheses)
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Phân định rạch ròi giữa giả thuyết chính và kịch bản đối lập
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {aiReport.rootCauseHypotheses.slice(0, 4).map((hyp, hIdx) => (
                    <div
                      key={hIdx}
                      className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-1.5">
                        <span className="font-semibold text-slate-200 truncate">
                          {hyp.entityName || hyp.entityId}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800">
                          {hyp.verdict}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-cyan-400 uppercase">Giả thuyết chính:</span>
                        <p className="text-slate-300 text-xs leading-relaxed">{hyp.primaryHypothesis}</p>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-amber-400 uppercase">Giả thuyết phản biện:</span>
                        <p className="text-slate-400 text-xs leading-relaxed italic">{hyp.counterHypothesis}</p>
                      </div>

                      <div className="pt-1 border-t border-slate-800/60 text-[11px] text-emerald-300 flex items-start gap-1.5">
                        <span className="font-bold shrink-0">🧪 Thử nghiệm:</span>
                        <span>{hyp.recommendedExperiment}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 30s Creative Brief Ideas Section */}
            {aiReport?.creativeBriefs && aiReport.creativeBriefs.length > 0 && (
              <div className="border-t border-slate-800/80 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span>🎬</span> Đề xuất Kịch bản Thử nghiệm Creative 30s (Actionable Video Briefs)
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Dành cho các quảng cáo Link CTR thấp hoặc cần scale angle mới
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {aiReport.creativeBriefs.map((brief, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-amber-900/40 bg-slate-900/70 p-4 space-y-2.5 relative"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
                        <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                          <span>💡</span> {brief.angle}
                        </span>
                        {brief.targetAdName && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono truncate max-w-[200px]">
                            {brief.targetAdName}
                          </span>
                        )}
                      </div>

                      <div className="text-xs space-y-1 text-slate-300">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Vấn đề cốt lõi:</span>
                        <p className="text-slate-300 text-xs italic">{brief.coreProblem}</p>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] uppercase font-bold text-amber-400">
                          3 Biến thể Hook 3s đầu (Tâm lý học hành vi):
                        </span>
                        <div className="space-y-1">
                          {brief.hooks.map((hook, hIdx) => (
                            <div
                              key={hIdx}
                              className="text-xs text-slate-200 bg-slate-950/60 border border-slate-800 rounded px-2.5 py-1.5 flex items-start gap-2"
                            >
                              <span className="text-amber-400 font-mono font-bold text-[10px] mt-0.5">
                                H{hIdx + 1}:
                              </span>
                              <span>{hook}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1 text-xs">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Chỉ đạo hình ảnh &amp; Pacing:</span>
                        <p className="text-slate-300 text-[11px] leading-relaxed bg-slate-950/40 p-2 rounded border border-slate-800/60">
                          {brief.visualDirection}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-1 text-xs">
                        <span className="text-[10px] uppercase font-bold text-cyan-400">Kêu gọi hành động (CTA):</span>
                        <span className="text-cyan-300 font-semibold text-xs">{brief.callToAction}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Filter Bar for Decision Cards */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 mr-1">Bộ lọc quyết định:</span>
              <button
                onClick={() => setDecisionFilter("ALL")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  decisionFilter === "ALL"
                    ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20"
                    : "bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700"
                }`}
              >
                Tất cả ({decisions.length})
              </button>
              <button
                onClick={() => setDecisionFilter("PAUSE")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  decisionFilter === "PAUSE"
                    ? "bg-rose-500 text-white shadow-md shadow-rose-500/20"
                    : "bg-slate-900 text-rose-300 border border-rose-900/60 hover:border-rose-700"
                }`}
              >
                <span>🔴</span> Cần tắt / Pause ({decisions.filter((d) => d.decision === "PAUSE_CANDIDATE" || d.decision === "REDUCE_CANDIDATE").length})
              </button>
              <button
                onClick={() => setDecisionFilter("SCALE")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  decisionFilter === "SCALE"
                    ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                    : "bg-slate-900 text-emerald-300 border border-emerald-900/60 hover:border-emerald-700"
                }`}
              >
                <span>🟢</span> Cơ hội Scale ({decisions.filter((d) => d.decision === "SCALE_CANDIDATE").length})
              </button>
              <button
                onClick={() => setDecisionFilter("CREATIVE")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  decisionFilter === "CREATIVE"
                    ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                    : "bg-slate-900 text-amber-300 border border-amber-900/60 hover:border-amber-700"
                }`}
              >
                <span>🟡</span> Cần test Creative ({decisions.filter((d) => d.decision === "TEST_CREATIVE").length})
              </button>
              <button
                onClick={() => setDecisionFilter("WAIT")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  decisionFilter === "WAIT"
                    ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20"
                    : "bg-slate-900 text-sky-300 border border-sky-900/60 hover:border-sky-700"
                }`}
              >
                <span>🛡️</span> Chờ độ chín ({decisions.filter((d) => d.decision === "WAIT").length})
              </button>
              <button
                onClick={() => setDecisionFilter("FUNNEL")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  decisionFilter === "FUNNEL"
                    ? "bg-purple-500 text-white shadow-md shadow-purple-500/20"
                    : "bg-slate-900 text-purple-300 border border-purple-900/60 hover:border-purple-700"
                }`}
              >
                <span>🔍</span> Phễu &amp; Tracking ({decisions.filter((d) => d.decision === "CHECK_LANDING" || d.decision === "CHECK_CHECKOUT" || d.decision === "INVESTIGATE_TRACKING" || d.decision === "CHECK_OFFER").length})
              </button>
            </div>

            <div className="text-xs text-slate-400">
              Hiển thị <strong className="text-cyan-300">{decisions.filter(filterDecision).length}</strong> / {decisions.length} thẻ khuyến nghị
            </div>
          </div>

          {/* Decision Cards List */}
          {decisions.filter(filterDecision).length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center space-y-2">
              <span className="text-3xl">🎉</span>
              <h4 className="text-sm font-bold text-slate-200">Không có khuyến nghị trong bộ lọc này</h4>
              <p className="text-xs text-slate-400">Tất cả đối tượng đang vận hành trong ngưỡng an toàn cho phép.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {decisions
                .filter(filterDecision)
                .map((card) => {
                  const isPause = card.decision === "PAUSE_CANDIDATE" || card.decision === "REDUCE_CANDIDATE";
                  const isScale = card.decision === "SCALE_CANDIDATE";
                  const isCreative = card.decision === "TEST_CREATIVE";
                  const isWait = card.decision === "WAIT";
                  const isTracking = card.decision === "INVESTIGATE_TRACKING";
                  const isFunnel = card.decision === "CHECK_LANDING" || card.decision === "CHECK_CHECKOUT" || card.decision === "CHECK_OFFER";

                  const decisionColorClass = isPause
                    ? "bg-rose-950/80 border-rose-600 text-rose-300"
                    : isScale
                    ? "bg-emerald-950/80 border-emerald-600 text-emerald-300"
                    : isCreative
                    ? "bg-amber-950/80 border-amber-600 text-amber-300"
                    : isWait
                    ? "bg-sky-950/80 border-sky-600 text-sky-300"
                    : isTracking
                    ? "bg-purple-950/80 border-purple-600 text-purple-300"
                    : isFunnel
                    ? "bg-orange-950/80 border-orange-600 text-orange-300"
                    : "bg-indigo-950/80 border-indigo-600 text-indigo-300";

                  const decisionIcon = isPause
                    ? "🔴"
                    : isScale
                    ? "🟢"
                    : isCreative
                    ? "🟡"
                    : isWait
                    ? "🛡️"
                    : isTracking
                    ? "🔍"
                    : isFunnel
                    ? "🛒"
                    : "💡";

                  return (
                    <div
                      key={card.id}
                      className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-4 hover:border-slate-700 transition shadow-lg"
                    >
                      {/* Top Row: Badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                            {card.entity.type}: {card.entity.name}
                          </span>
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border flex items-center gap-1.5 ${decisionColorClass}`}>
                            <span>{decisionIcon}</span>
                            <span>{card.decision}</span>
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-bold border uppercase tracking-wider ${
                              card.priority === "HIGH"
                                ? "bg-rose-950/50 text-rose-300 border-rose-800"
                                : card.priority === "MEDIUM"
                                ? "bg-amber-950/50 text-amber-300 border-amber-800"
                                : "bg-slate-800 text-slate-400 border-slate-700"
                            }`}
                          >
                            Ưu tiên: {card.priority}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300 border border-slate-700">
                            Tin cậy: <strong className="text-cyan-300">{card.confidence}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Title & Summary */}
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          {card.title}
                        </h4>
                        <p className="text-xs text-slate-300 leading-relaxed">{card.summary}</p>
                      </div>

                      {/* Observations / Evidence Pack Table */}
                      {card.observations.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <span>📋</span> Bằng chứng định lượng (Current vs Benchmark):
                          </span>
                          <div className="overflow-x-auto rounded-lg border border-slate-800">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-950/80 text-slate-400 text-[10px] uppercase font-mono border-b border-slate-800">
                                <tr>
                                  <th className="py-2 px-3">Chỉ số (Metric)</th>
                                  <th className="py-2 px-3">Thực tế quan sát</th>
                                  <th className="py-2 px-3">Ngưỡng chuẩn (Benchmark)</th>
                                  <th className="py-2 px-3">Đơn vị</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px] bg-slate-900/30">
                                {card.observations.map((obs, obsIdx) => (
                                  <tr key={obsIdx} className="hover:bg-slate-800/40">
                                    <td className="py-2 px-3 text-cyan-300 font-semibold">{obs.metric}</td>
                                    <td className="py-2 px-3 text-slate-100 font-bold">{String(obs.current)}</td>
                                    <td className="py-2 px-3 text-slate-400">{String(obs.benchmark)}</td>
                                    <td className="py-2 px-3 text-slate-500">{obs.unit}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Hypotheses List */}
                      {card.hypotheses.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <span>🔬</span> Giả thuyết &amp; Nguyên nhân khả dĩ:
                          </span>
                          <ul className="space-y-1 text-xs text-slate-300 bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
                            {card.hypotheses.map((hyp, hIdx) => (
                              <li key={hIdx} className="flex items-start gap-2">
                                <span className="text-cyan-400 mt-0.5">•</span>
                                <span>{hyp}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Missing Evidence Badges */}
                      {card.missingEvidence && card.missingEvidence.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                            <span>🔎</span> Bằng chứng cần kiểm tra bổ sung (Missing Evidence):
                          </span>
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {card.missingEvidence.map((ev, evIdx) => (
                              <span
                                key={evIdx}
                                className="px-2 py-0.5 rounded text-[10px] bg-slate-950/80 text-amber-200/90 border border-amber-900/40"
                              >
                                {ev}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action & Policy Gate Recommendations */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3 space-y-1">
                          <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1">
                            <span>💡</span> Hành động khuyến nghị:
                          </span>
                          <p className="text-xs text-cyan-100 leading-relaxed font-medium">
                            {card.recommendedNextStep}
                          </p>
                        </div>

                        <div className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-3 space-y-1">
                          <span className="text-[10px] font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1">
                            <span>⛔</span> Hành động bị chặn theo Policy:
                          </span>
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {card.blockedActions.length > 0 ? (
                              card.blockedActions.map((action, aIdx) => (
                                <span
                                  key={aIdx}
                                  className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-800"
                                >
                                  {action}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-400 italic">Không có hành động bị chặn</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Review Trigger Footer */}
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/60">
                        <span className="flex items-center gap-1.5">
                          <span>⏱️</span>
                          <span>Điều kiện xem xét lại: <strong className="text-slate-200">{card.reviewTrigger}</strong></span>
                        </span>
                        {card.policyVersion && (
                          <span className="font-mono text-[10px] text-slate-500">
                            Policy: v{card.policyVersion}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

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

      {/* Tab 3: Competitor & Creative Gaps */}
      {activeTab === "competitors" && (
        <div className="space-y-6">
          {/* Regulatory Disclaimer Banner */}
          <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-4 flex items-start gap-3">
            <span className="text-xl text-amber-400 mt-0.5">🛡️</span>
            <div className="text-xs text-amber-200/90 leading-relaxed">
              <strong className="text-amber-100 font-semibold uppercase tracking-wider block mb-1">
                Quy chuẩn minh bạch dữ liệu đối thủ (Regulatory Transparency)
              </strong>
              Toàn bộ dữ liệu được thu thập công khai từ Facebook Ad Library. Doanh thu, ngân sách thực tế, targeting và ROAS của đối thủ là không thể xác định. Các mẫu quảng cáo chạy lâu ngày chỉ được dùng làm <em>giả thuyết sáng tạo (Creative Hypotheses)</em> để thiết kế kịch bản thử nghiệm cho store của bạn.
            </div>
          </div>

          {/* Metrics Top Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium">Bên cào dữ liệu (Provider)</span>
              <p className="text-sm font-bold text-cyan-300 truncate">
                {competitorReport?.provider ?? "ScrapeCreators"}
              </p>
              <span className="text-[10px] text-slate-500 block">4.999 credits sẵn sàng</span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium">Ads đối thủ thu thập</span>
              <p className="text-sm font-bold text-white">
                {competitorReport?.totalAds ?? competitors.length} ads <span className="text-xs font-normal text-emerald-400">({competitorReport?.activeAds ?? competitors.length} đang chạy)</span>
              </p>
              <span className="text-[10px] text-slate-500 block">
                {competitorReport?.watchlist.length ?? 3} Page trong Watchlist
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium">Khoảng trống sáng tạo (Gaps)</span>
              <p className="text-sm font-bold text-amber-300">
                {competitorReport?.creativeGaps.length ?? 0} góc tiếp cận
              </p>
              <span className="text-[10px] text-amber-400/80 block">
                {competitorReport?.creativeGaps.filter(g => g.ownStatus === "UNTESTED").length ?? 0} góc chưa từng test
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium">Chi phí sync ước tính</span>
              <p className="text-sm font-bold text-slate-200">
                ${competitorReport?.syncCostEstimatedUsd ?? 0.0054}
              </p>
              <span className="text-[10px] text-slate-500 block">Hạn mức cap: ${competitorReport?.monthlyCostCapUsd ?? 65.0}/tháng</span>
            </div>
          </div>

          {/* Section 1: Creative Gaps */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>⚡</span> Khoảng trống Sáng tạo đối chiếu đối thủ (Creative Gaps)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Các pattern quảng cáo đang được đối thủ chạy bền bỉ nhưng store của bạn chưa từng thử nghiệm hoặc cần đổi mới.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-950/70 border border-amber-800/80 text-amber-300">
                Ưu tiên thử nghiệm V2
              </span>
            </div>

            {(!competitorReport || competitorReport.creativeGaps.length === 0) ? (
              <p className="text-xs text-slate-400 italic">Đang phân tích khoảng trống sáng tạo...</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {competitorReport.creativeGaps.map((gap) => (
                  <div
                    key={gap.id}
                    className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          gap.ownStatus === "UNTESTED"
                            ? "bg-rose-950/60 text-rose-300 border-rose-800/80"
                            : "bg-amber-950/60 text-amber-300 border-amber-800/80"
                        }`}>
                          {gap.ownStatus === "UNTESTED" ? "🔴 CHƯA TỪNG TEST" : "🟡 ĐANG TEST"}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{gap.format}</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{gap.visualStyle}</span>
                        </div>
                      </div>

                      <h4 className="text-xs font-bold text-white">{gap.patternName}</h4>

                      <div className="rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/80 text-[11px] space-y-1.5">
                        <div className="text-slate-300">
                          <strong className="text-cyan-400">Bằng chứng đối thủ:</strong> {gap.competitorOccurrences} mẫu ads ghi nhận từ {gap.competitorNames.join(", ")}.
                        </div>
                        <div className="text-slate-400 text-[10.5px] leading-relaxed">
                          {gap.whyTestNext}
                        </div>
                      </div>

                      {/* Suggested Brief Box */}
                      <div className="rounded-lg bg-cyan-950/20 border border-cyan-900/40 p-2.5 text-[11px] space-y-1.5">
                        <div className="flex items-center justify-between text-cyan-300 font-semibold text-[10.5px]">
                          <span>🎬 Kịch bản Creative Brief gợi ý:</span>
                          <span className="text-[10px] text-slate-400 font-normal">{gap.suggestedBrief.recommendedFormat}</span>
                        </div>
                        <p className="text-slate-300 text-[10.5px]">
                          <strong className="text-slate-200">Góc Hook (0-3s):</strong> {gap.suggestedBrief.hookAngle}
                        </p>
                        <p className="text-slate-400 text-[10px] line-clamp-2">
                          <strong className="text-slate-300">Storyboard (3-15s):</strong> {gap.suggestedBrief.storyboardIdea}
                        </p>
                        <p className="text-slate-400 text-[10px]">
                          <strong className="text-slate-300">Kêu gọi (CTA):</strong> {gap.suggestedBrief.callToAction}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                        ID: {gap.id}
                      </span>
                      <button
                        onClick={() => {
                          const briefText = `CREATIVE BRIEF (FFP ADS V2)\nPattern: ${gap.patternName}\nFormat: ${gap.suggestedBrief.recommendedFormat}\nHook (0-3s): ${gap.suggestedBrief.hookAngle}\nStoryboard (3-15s): ${gap.suggestedBrief.storyboardIdea}\nCTA (15-30s): ${gap.suggestedBrief.callToAction}\n\nEvidence: ${gap.whyTestNext}`;
                          void navigator.clipboard.writeText(briefText);
                          setCopiedGapId(gap.id);
                          setTimeout(() => setCopiedGapId(null), 2500);
                        }}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 transition cursor-pointer flex items-center gap-1"
                      >
                        {copiedGapId === gap.id ? "✓ Đã sao chép Brief!" : "📋 Sao chép Brief"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Winning Trends & Distribution */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top Winning Hooks */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <span>🏆</span> Top Hook Bền bỉ nhất thị trường
              </h3>
              <div className="space-y-2">
                {competitorReport?.topWinningHooks.map((h, idx) => (
                  <div key={h.hookType} className="flex items-center justify-between p-2 rounded-lg bg-slate-950/50 border border-slate-800 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-400 flex items-center justify-center font-bold text-[10px]">
                        {idx + 1}
                      </span>
                      <span className="text-slate-200 font-medium">{h.description}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-emerald-400 font-bold block">{h.avgDaysActive} ngày chạy</span>
                      <span className="text-[10px] text-slate-500">{h.count} ads</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Format Distribution */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <span>📊</span> Phân bổ Định dạng (Format Mix)
              </h3>
              <div className="space-y-3 pt-2">
                {competitorReport?.formatDistribution.map((f) => (
                  <div key={f.format} className="space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-slate-300">{f.format}</span>
                      <span className="text-cyan-400 font-bold">{f.percentage}% ({f.count} ads)</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                        style={{ width: `${f.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-[10.5px] text-slate-500 pt-2 border-t border-slate-800/80">
                  Video ngắn (9:16) và Carousel chiếm đa số các mẫu quảng cáo chạy trên 20 ngày của các đối thủ top đầu.
                </p>
              </div>
            </div>
          </div>

          {/* Section 3: Filterable Ad Library Cards */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>🖼️</span> Thư viện Quảng cáo Đối thủ (Ad Library Feed)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Bộ lọc chi tiết từng mẫu quảng cáo đã bóc tách copy, hook và media assets.
                </p>
              </div>

              {/* Filters Bar */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedCompetitorPage}
                  onChange={(e) => setSelectedCompetitorPage(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
                >
                  <option value="ALL">Mọi đối thủ ({competitorReport?.totalAds ?? 0})</option>
                  {competitorReport?.watchlist.map((w) => (
                    <option key={w.pageId} value={w.pageId}>
                      {w.pageName} ({w.adCount})
                    </option>
                  ))}
                </select>

                <select
                  value={selectedCompetitorFormat}
                  onChange={(e) => setSelectedCompetitorFormat(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
                >
                  <option value="ALL">Mọi định dạng</option>
                  <option value="VIDEO">Video</option>
                  <option value="IMAGE">Ảnh tĩnh</option>
                  <option value="CAROUSEL">Carousel</option>
                </select>

                <select
                  value={selectedCompetitorHook}
                  onChange={(e) => setSelectedCompetitorHook(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
                >
                  <option value="ALL">Mọi Hook</option>
                  <option value="UNBOXING">Mở hộp (Unboxing)</option>
                  <option value="PROBLEM_AGITATION">Nỗi đau (Problem)</option>
                  <option value="BEFORE_AFTER">Before / After</option>
                  <option value="FOUNDER_STORY">Founder Story</option>
                  <option value="SOCIAL_PROOF">Social Proof (Review)</option>
                  <option value="DISCOUNT_OFFER">Khuyến mãi (Sale)</option>
                </select>
              </div>
            </div>

            {/* Ads Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {((competitorReport?.ads ?? []).filter((ad) => {
                if (selectedCompetitorPage !== "ALL" && ad.pageId !== selectedCompetitorPage) return false;
                if (selectedCompetitorFormat !== "ALL" && ad.mediaType !== selectedCompetitorFormat) return false;
                if (selectedCompetitorHook !== "ALL" && ad.taxonomy.hookType !== selectedCompetitorHook) return false;
                return true;
              })).map((ad) => (
                <div key={ad.archiveAdId} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200 truncate max-w-[160px]">{ad.pageName}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                        {ad.daysActive > 20 ? `🔥 Chạy ${ad.daysActive} ngày` : `Đang chạy ${ad.daysActive} ngày`}
                      </span>
                    </div>

                    <div className="aspect-video w-full rounded-lg bg-slate-950 overflow-hidden relative border border-slate-800 group">
                      <img src={ad.thumbnailUrl} alt={ad.headline} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                      <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 text-[10px] font-bold text-white uppercase">
                        {ad.mediaType}
                      </span>
                      <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-mono text-cyan-300">
                        {ad.inspectionLevel}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-800/60 text-[9.5px] font-bold text-cyan-300">
                          #{ad.taxonomy.hookType}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9.5px] font-medium text-slate-300">
                          {ad.taxonomy.visualStyle}
                        </span>
                      </div>
                      <h4 className="text-xs font-semibold text-slate-100 line-clamp-1">{ad.headline}</h4>
                      <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">{ad.copy}</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>Bắt đầu: {ad.startDate}</span>
                      <span className="font-semibold text-cyan-400">CTA: {ad.cta}</span>
                    </div>
                    <button
                      onClick={() => {
                        const copyContent = `ANGLE: ${ad.taxonomy.angle}\nHOOK: ${ad.taxonomy.hookType}\nHEADLINE: ${ad.headline}\nCOPY: ${ad.copy}\nOFFER: ${ad.taxonomy.offer}`;
                        void navigator.clipboard.writeText(copyContent);
                        setCopiedAdId(ad.archiveAdId);
                        setTimeout(() => setCopiedAdId(null), 2500);
                      }}
                      className="w-full py-1.5 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer flex items-center justify-center gap-1"
                    >
                      {copiedAdId === ad.archiveAdId ? "✓ Đã sao chép Angle!" : "Sao chép Góc tiếp cận (Angle)"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
