import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  AdsIntelligenceClient,
  AdsStoreSummary,
  AdsHierarchyCampaign,
  AdsDataHealth,
  AdsReconciliationReport,
  DecisionCard,
  AiStrategicReport,
  CompetitorIntelligenceReport,
  CreativeBrief,
  AdsExperiment,
  GuardedWriteProposal,
  GuardedWriteExecutionResult,
  ExperimentOutcomeVerdict,
} from "../types";
import {
  readActiveStoreId,
  persistBrowserActiveStoreId,
} from "../../../shared/active-store";

// Sub-components
import { AdsHeader } from "./components/AdsHeader";
import { ExecutiveKpiRibbon } from "./components/ExecutiveKpiRibbon";
import { DecisionDrawer } from "./components/DecisionDrawer";
import { GuardedWriteModal } from "./components/GuardedWriteModal";
import { McpModal } from "./components/McpModal";
import { ExperimentOutcomeModal } from "./components/ExperimentOutcomeModal";

// Sub-tabs
import { DecisionsTab } from "./tabs/DecisionsTab";
import { HierarchyTab } from "./tabs/HierarchyTab";
import { FunnelTab } from "./tabs/FunnelTab";
import { CompetitorsTab } from "./tabs/CompetitorsTab";
import { ExperimentsTab } from "./tabs/ExperimentsTab";
import { SystemHealthTab } from "./tabs/SystemHealthTab";

export type AdsTabId = "decisions" | "hierarchy" | "funnel" | "competitors" | "experiments" | "health";

export function AdsIntelligencePage({ client }: { readonly client: AdsIntelligenceClient }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const currentStoreId = params.get("storeId") || readActiveStoreId(typeof window !== "undefined" ? window.localStorage : undefined) || "chillgen";

  const [activeTab, setActiveTab] = useState<AdsTabId>("decisions");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [actionNotification, setActionNotification] = useState<string | null>(null);

  // Core Data States
  const [summary, setSummary] = useState<AdsStoreSummary | null>(null);
  const [campaigns, setCampaigns] = useState<readonly AdsHierarchyCampaign[]>([]);
  const [health, setHealth] = useState<AdsDataHealth | null>(null);
  const [reconciliation, setReconciliation] = useState<AdsReconciliationReport | null>(null);
  const [decisions, setDecisions] = useState<readonly DecisionCard[]>([]);
  const [aiReport, setAiReport] = useState<AiStrategicReport | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [competitorReport, setCompetitorReport] = useState<CompetitorIntelligenceReport | null>(null);
  const [briefs, setBriefs] = useState<readonly CreativeBrief[]>([]);
  const [experiments, setExperiments] = useState<readonly AdsExperiment[]>([]);

  // Modal & Drawer States
  const [selectedDrawerCard, setSelectedDrawerCard] = useState<DecisionCard | null>(null);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [guardedProposal, setGuardedProposal] = useState<GuardedWriteProposal | null>(null);
  const [executingGuardedWrite, setExecutingGuardedWrite] = useState(false);
  const [executionResult, setExecutionResult] = useState<GuardedWriteExecutionResult | null>(null);
  const [outcomeExperiment, setOutcomeExperiment] = useState<AdsExperiment | null>(null);
  const [savingOutcome, setSavingOutcome] = useState(false);

  // Sync store change to URL and global store persistence
  const handleStoreChange = (newStoreId: string) => {
    persistBrowserActiveStoreId(newStoreId);
    setParams({ storeId: newStoreId });
  };

  // Fetch all store data
  const loadData = async (storeId: string) => {
    setLoading(true);
    try {
      const [sum, camp, hlth, recon, decs, ai, compRep, brfs, exps] = await Promise.all([
        client.getStoreSummary(storeId),
        client.getCampaignHierarchy(storeId),
        client.getDataHealth(storeId),
        client.getReconciliationReport ? client.getReconciliationReport(storeId) : Promise.resolve(null),
        client.getDecisionCards ? client.getDecisionCards(storeId) : Promise.resolve([]),
        client.getAiStrategicReport ? client.getAiStrategicReport(storeId) : Promise.resolve(null),
        client.getCompetitorIntelligence ? client.getCompetitorIntelligence(storeId) : Promise.resolve(null),
        client.getBriefs ? client.getBriefs(storeId) : Promise.resolve([]),
        client.getExperiments ? client.getExperiments(storeId) : Promise.resolve([]),
      ]);
      setSummary(sum);
      setCampaigns(camp);
      setHealth(hlth);
      setReconciliation(recon);
      setDecisions(decs || []);
      setAiReport(ai);
      setCompetitorReport(compRep);
      setBriefs(brfs || []);
      setExperiments(exps || []);
    } catch {
      // Fallback handlers handled in client
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(currentStoreId);
  }, [currentStoreId]);

  // Actions
  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage("Đang gọi live Meta Graph API v26.0 & GA4 Data API...");
    try {
      if (client.syncNow) {
        const res = await client.syncNow(currentStoreId);
        setSyncMessage(res.message || "Đã đồng bộ dữ liệu mới nhất!");
      }
      await loadData(currentStoreId);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 4000);
    }
  };

  const handleAiAnalyze = async () => {
    if (!client.getAiStrategicReport) return;
    setAiAnalyzing(true);
    try {
      const res = await client.getAiStrategicReport(currentStoreId, true);
      setAiReport(res);
      setActionNotification("✨ Đã cập nhật Báo cáo Chiến lược AI mới nhất!");
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleCreateBriefFromDecision = async (decisionId: string) => {
    if (!client.generateBrief) return;
    try {
      const newBrief = await client.generateBrief(currentStoreId, { source: "decision", sourceId: decisionId });
      setBriefs((prev) => [newBrief, ...prev]);
      setSelectedDrawerCard(null);
      setActiveTab("experiments");
      setActionNotification(`🎬 Đã tạo kịch bản Creative Brief mới: "${newBrief.title}"`);
    } catch {
      setActionNotification("Lỗi khi tạo Brief từ quyết định");
    }
  };

  const handleCreateBriefFromGap = async (gapId: string) => {
    if (!client.generateBrief) return;
    try {
      const newBrief = await client.generateBrief(currentStoreId, { source: "gap", sourceId: gapId });
      setBriefs((prev) => [newBrief, ...prev]);
      setActiveTab("experiments");
      setActionNotification(`💡 Đã tạo Creative Brief từ khoảng trống đối thủ: "${newBrief.title}"`);
    } catch {
      setActionNotification("Lỗi khi tạo Brief từ đối thủ");
    }
  };

  const handleApproveBrief = async (briefId: string) => {
    if (!client.updateBriefStatus) return;
    try {
      const updated = await client.updateBriefStatus(briefId, "APPROVED", "Duyệt bởi Media Buyer");
      setBriefs((prev) => prev.map((b) => (b.briefId === briefId ? updated : b)));
      setActionNotification("✓ Kịch bản Creative Brief đã được phê duyệt sẵn sàng sản xuất!");
    } catch {
      setActionNotification("Lỗi khi duyệt Brief");
    }
  };

  const handleCreateExperimentFromBrief = async (briefId: string) => {
    if (!client.createExperiment) return;
    try {
      const newExp = await client.createExperiment(currentStoreId, { briefId });
      setExperiments((prev) => [newExp, ...prev]);
      setActionNotification(`🚀 Đã khởi tạo thử nghiệm A/B: "${newExp.title}"`);
    } catch {
      setActionNotification("Lỗi khi khởi tạo thử nghiệm");
    }
  };

  const handleCopyBriefMarkdown = (brief: CreativeBrief) => {
    try {
      const scenes = brief.storyboard
        .map((s) => `| ${s.timestamp} | ${s.scene} | ${s.visualAction} | "${s.audioVoiceover}" | ${s.onScreenText} |`)
        .join("\n");
      const md = `# CREATIVE BRIEF: ${brief.title}\n**Store:** ${brief.storeId} | **Status:** ${brief.status}\n**Format:** ${brief.creativeConcept.format} (${brief.creativeConcept.aspectRatio})\n**Hook Angle:** ${brief.creativeConcept.hookAngle}\n\n## 1. STORYBOARD (30s Video)\n| Timestamp | Scene | Visual Action | Audio Voiceover | On-Screen Text |\n|---|---|---|---|---|\n${scenes}\n\n## 2. COPY & CTA\n- **Primary Text:** ${brief.copyAndCta.primaryText}\n- **Headline:** ${brief.copyAndCta.headline}\n- **CTA Button:** ${brief.copyAndCta.ctaButton}\n`;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(md);
        setActionNotification(`📋 Đã sao chép kịch bản "${brief.title}" vào Clipboard (Markdown)!`);
      }
    } catch {
      setActionNotification("Lỗi sao chép clipboard");
    }
  };

  const handleTriggerGuardedWrite = async (card: DecisionCard) => {
    if (!client.proposeGuardedWrite) return;
    try {
      const proposal = await client.proposeGuardedWrite(currentStoreId, card.id);
      setGuardedProposal(proposal);
      setExecutionResult(null);
    } catch {
      setActionNotification("Không thể tạo đề xuất Guarded Write");
    }
  };

  const handleExecuteGuardedWrite = async (operatorConfirmText?: string) => {
    if (!guardedProposal || !client.executeGuardedWrite) return;
    setExecutingGuardedWrite(true);
    try {
      const res = await client.executeGuardedWrite(guardedProposal.proposalId, {
        operatorConfirmText: operatorConfirmText || "Xác nhận bởi Media Buyer",
        forceAllowV3: true,
      });
      setExecutionResult(res);
      if (res.success) {
        setActionNotification(`🛡️ Thực thi Guarded Write thành công! (Mã kiểm toán: ${res.auditLogId})`);
        await loadData(currentStoreId);
      }
    } finally {
      setExecutingGuardedWrite(false);
    }
  };

  const handleSaveExperimentOutcome = async (
    verdict: ExperimentOutcomeVerdict,
    deltaPct: number,
    learningNotes: string
  ) => {
    if (!outcomeExperiment || !client.updateExperimentOutcome) return;
    setSavingOutcome(true);
    try {
      const updated = await client.updateExperimentOutcome(outcomeExperiment.id, {
        status: "COMPLETED",
        results: {
          controlSpend: outcomeExperiment.limits.budgetCapUsd / 2,
          variantSpend: outcomeExperiment.limits.budgetCapUsd / 2,
          controlOutcomes: 5,
          variantOutcomes: 8,
          controlMetricValue: 50.0,
          variantMetricValue: 35.0,
          deltaPercent: deltaPct,
          confidence: "HIGH",
          confoundersNoted: [],
          reviewer: "Media Buyer",
        },
        learning: {
          verdict,
          conclusion: learningNotes,
          scope: "CREATIVE_HOOK",
          nextRecommendedTest: "Scale winning creative to evergreen campaigns",
        },
      });
      setExperiments((prev) => prev.map((e) => (e.id === outcomeExperiment.id ? updated : e)));
      setOutcomeExperiment(null);
      setActionNotification(`🏆 Đã ghi nhận kết quả ${verdict} cho thử nghiệm!`);
    } finally {
      setSavingOutcome(false);
    }
  };

  return (
    <div className="flex-1 bg-slate-950 p-4 sm:p-6 lg:p-8 text-slate-100 max-w-7xl mx-auto w-full space-y-5">
      {/* 1. Header Command Bar */}
      <AdsHeader
        currentStoreId={currentStoreId}
        onStoreChange={handleStoreChange}
        summary={summary}
        syncing={syncing}
        syncMessage={syncMessage}
        onSync={handleSync}
        onOpenMcp={() => setShowMcpModal(true)}
      />

      {/* Action Notification Alert Toast */}
      {actionNotification && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-950/90 via-indigo-950/90 to-slate-900 border border-purple-600/70 text-purple-200 text-xs shadow-lg animate-in fade-in slide-in-from-top duration-300">
          <div className="flex items-center gap-2">
            <span>📢</span>
            <span className="font-semibold">{actionNotification}</span>
          </div>
          <button
            onClick={() => setActionNotification(null)}
            className="text-purple-400 hover:text-white font-bold px-2 py-0.5 rounded cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 2. Unified Executive KPI Ribbon (3 Clusters) */}
      <ExecutiveKpiRibbon summary={summary} reconciliation={reconciliation} />

      {/* 3. Streamlined Tabs Navigation */}
      <div className="flex border-b border-slate-800 gap-2 overflow-x-auto whitespace-nowrap">
        {[
          { id: "decisions", label: "🎯 Quyết định & AI", badge: decisions.length },
          { id: "hierarchy", label: "📊 Chiến dịch & Ads", badge: campaigns.length },
          { id: "funnel", label: "🔄 Phễu & Đối soát", badge: null },
          { id: "competitors", label: "🕵️ Spy Đối thủ", badge: competitorReport?.activeAds || null },
          { id: "experiments", label: "🧪 Briefs & Thử nghiệm", badge: briefs.length },
          { id: "health", label: "🛡️ Kết nối & Hệ thống", badge: null },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as AdsTabId)}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 -mb-px flex items-center gap-1.5 cursor-pointer ${
              activeTab === tab.id
                ? "border-cyan-400 text-cyan-300 bg-slate-900/60 shadow-sm"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30"
            }`}
          >
            <span>{tab.label}</span>
            {tab.badge !== null && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950 text-slate-400 border border-slate-800 font-mono font-bold">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 4. Active Tab Content Rendering */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          <div className="text-xs text-slate-400 font-medium">Đang tải dữ liệu Ads Intelligence...</div>
        </div>
      ) : (
        <div>
          {activeTab === "decisions" && (
            <DecisionsTab
              decisions={decisions}
              aiReport={aiReport}
              aiAnalyzing={aiAnalyzing}
              onRunAiAnalysis={handleAiAnalyze}
              onSelectCard={(card) => setSelectedDrawerCard(card)}
              onTriggerGuardedWrite={handleTriggerGuardedWrite}
              onCreateBrief={handleCreateBriefFromDecision}
            />
          )}

          {activeTab === "hierarchy" && <HierarchyTab campaigns={campaigns} />}

          {activeTab === "funnel" && <FunnelTab reconciliation={reconciliation} summary={summary} />}

          {activeTab === "competitors" && (
            <CompetitorsTab
              competitorReport={competitorReport}
              onCreateBriefFromGap={handleCreateBriefFromGap}
            />
          )}

          {activeTab === "experiments" && (
            <ExperimentsTab
              briefs={briefs}
              experiments={experiments}
              onApproveBrief={handleApproveBrief}
              onCreateExperiment={handleCreateExperimentFromBrief}
              onCopyMarkdown={handleCopyBriefMarkdown}
              onOpenOutcomeModal={(exp) => setOutcomeExperiment(exp)}
            />
          )}

          {activeTab === "health" && (
            <SystemHealthTab health={health} summary={summary} onSync={handleSync} />
          )}
        </div>
      )}

      {/* 5. Modals & Slide-over Drawer */}
      <DecisionDrawer
        card={selectedDrawerCard}
        onClose={() => setSelectedDrawerCard(null)}
        onTriggerGuardedWrite={(card) => {
          setSelectedDrawerCard(null);
          void handleTriggerGuardedWrite(card);
        }}
        onCreateBrief={handleCreateBriefFromDecision}
      />

      <GuardedWriteModal
        proposal={guardedProposal}
        executing={executingGuardedWrite}
        executionResult={executionResult}
        onClose={() => {
          setGuardedProposal(null);
          setExecutionResult(null);
        }}
        onExecute={handleExecuteGuardedWrite}
      />

      {showMcpModal && <McpModal onClose={() => setShowMcpModal(false)} />}

      <ExperimentOutcomeModal
        experiment={outcomeExperiment}
        saving={savingOutcome}
        onClose={() => setOutcomeExperiment(null)}
        onSave={handleSaveExperimentOutcome}
      />
    </div>
  );
}
