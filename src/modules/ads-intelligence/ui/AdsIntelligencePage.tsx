import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  AdsGatewayStore,
  AdsShopifySummary,
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
  LocalAiRunnerInfo,
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
import { StoreProfileModal } from "./components/StoreProfileModal";

// Sub-tabs
import { DecisionsTab } from "./tabs/DecisionsTab";
import { HierarchyTab } from "./tabs/HierarchyTab";
import { FunnelTab } from "./tabs/FunnelTab";
import { CompetitorsTab } from "./tabs/CompetitorsTab";
import { ExperimentsTab } from "./tabs/ExperimentsTab";
import { SystemHealthTab } from "./tabs/SystemHealthTab";

export type AdsTabId = "decisions" | "hierarchy" | "funnel" | "competitors" | "experiments" | "health";

export interface StoreDataRecord {
  shopifySummary: AdsShopifySummary | null;
  summary: AdsStoreSummary | null;
  campaigns: readonly AdsHierarchyCampaign[];
  health: AdsDataHealth | null;
  reconciliation: AdsReconciliationReport | null;
  decisions: readonly DecisionCard[];
  aiReport: AiStrategicReport | null;
  competitorReport: CompetitorIntelligenceReport | null;
  briefs: readonly CreativeBrief[];
  experiments: readonly AdsExperiment[];
  sourceErrors: Record<string, string>;
  loadedSources: Set<string>;
  cachedAt: number;
}

function createEmptyStoreRecord(): StoreDataRecord {
  return {
    shopifySummary: null,
    summary: null,
    campaigns: [],
    health: null,
    reconciliation: null,
    decisions: [],
    aiReport: null,
    competitorReport: null,
    briefs: [],
    experiments: [],
    sourceErrors: {},
    loadedSources: new Set<string>(),
    cachedAt: 0,
  };
}

const CORE_SOURCES = ["Shopify", "Meta", "Kết nối", "Đối soát"] as const;

const TAB_SOURCES: Record<AdsTabId, readonly string[]> = {
  decisions: ["Quyết định", "AI"],
  hierarchy: ["Chiến dịch"],
  funnel: [],
  competitors: ["Đối thủ"],
  experiments: ["Briefs", "Thử nghiệm"],
  health: [],
};

export function AdsIntelligencePage({ client }: { readonly client: AdsIntelligenceClient }): React.JSX.Element {
  const [params] = useSearchParams();
  const [stores, setStores] = useState<readonly AdsGatewayStore[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    let lastRefreshedAt = Date.now();
    const refresh = async () => {
      try {
        const available = client.getStores ? await client.getStores() : [];
        if (active) {
          setStores(available);
          setError(null);
          lastRefreshedAt = Date.now();
        }
      } catch {
        if (active) setError("Không tải được danh sách store từ Gateway. Kiểm tra kết nối Gateway.");
      } finally {
        if (active) setLoaded(true);
      }
    };
    void refresh();
    const handleVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible" && Date.now() - lastRefreshedAt >= 30000) {
        void refresh();
      }
    };
    window.addEventListener("focus", refresh);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
    const timer = window.setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void refresh();
      }
    }, 30000);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
      window.clearInterval(timer);
    };
  }, [client]);
  if (error) return <p role="alert" className="p-6 text-amber-300">{error}</p>;
  if (!loaded) return <p role="status" className="p-6">Đang đọc danh sách store từ Gateway…</p>;
  if (!stores.length) return <p className="p-6">Chưa có store trong Gateway. Thêm kết nối Shopify tại màn hình quản lý Store.</p>;
  const requested = params.get("storeId") || readActiveStoreId(typeof window !== "undefined" ? window.localStorage : undefined);
  const selected = stores.find(store => store.storeId === requested) ?? stores[0];
  if (!selected) return <p>Chưa chọn store.</p>;
  return <AdsIntelligenceStorePage client={client} currentStoreId={selected.storeId} stores={stores} />;
}

function AdsIntelligenceStorePage({ client, currentStoreId, stores }: { readonly client: AdsIntelligenceClient; readonly currentStoreId: string; readonly stores: readonly AdsGatewayStore[] }): React.JSX.Element {
  const [, setParams] = useSearchParams();
  const generation = useRef(0);
  const storeCache = useRef<Map<string, StoreDataRecord>>(new Map());
  const activeStoreIdRef = useRef(currentStoreId);
  activeStoreIdRef.current = currentStoreId;

  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<AdsTabId>("decisions");
  const [loading, setLoading] = useState(true);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [actionNotification, setActionNotification] = useState<string | null>(null);

  // Core Data States
  const [shopifySummary, setShopifySummary] = useState<AdsShopifySummary | null>(null);
  const [summary, setSummary] = useState<AdsStoreSummary | null>(null);
  const [campaigns, setCampaigns] = useState<readonly AdsHierarchyCampaign[]>([]);
  const [health, setHealth] = useState<AdsDataHealth | null>(null);
  const [reconciliation, setReconciliation] = useState<AdsReconciliationReport | null>(null);
  const [decisions, setDecisions] = useState<readonly DecisionCard[]>([]);
  const [aiReport, setAiReport] = useState<AiStrategicReport | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [localAiRunners, setLocalAiRunners] = useState<readonly LocalAiRunnerInfo[]>([]);
  const [competitorReport, setCompetitorReport] = useState<CompetitorIntelligenceReport | null>(null);
  const [briefs, setBriefs] = useState<readonly CreativeBrief[]>([]);
  const [experiments, setExperiments] = useState<readonly AdsExperiment[]>([]);

  // Modal & Drawer States
  const [selectedDrawerCard, setSelectedDrawerCard] = useState<DecisionCard | null>(null);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [guardedProposal, setGuardedProposal] = useState<GuardedWriteProposal | null>(null);
  const [executingGuardedWrite, setExecutingGuardedWrite] = useState(false);
  const [executionResult, setExecutionResult] = useState<GuardedWriteExecutionResult | null>(null);
  const [outcomeExperiment, setOutcomeExperiment] = useState<AdsExperiment | null>(null);
  const [savingOutcome, setSavingOutcome] = useState(false);

  // Clear modal and drawer states when store changes
  useEffect(() => {
    setSelectedDrawerCard(null);
    setGuardedProposal(null);
    setExecutionResult(null);
    setOutcomeExperiment(null);
  }, [currentStoreId]);

  // Sync store change to URL and global store persistence
  const handleStoreChange = (newStoreId: string) => {
    persistBrowserActiveStoreId(newStoreId);
    setParams({ storeId: newStoreId });
  };

  const getSourceFetcher = useCallback(
    (name: string, storeId: string): (() => Promise<unknown>) | null => {
      switch (name) {
        case "Shopify":
          return () => (client.getShopifySummary ? client.getShopifySummary(storeId) : Promise.resolve(null));
        case "Meta":
          return () => client.getStoreSummary(storeId);
        case "Kết nối":
          return () => client.getDataHealth(storeId);
        case "Đối soát":
          return () => (client.getReconciliationReport ? client.getReconciliationReport(storeId) : Promise.resolve(null));
        case "Quyết định":
          return () => (client.getDecisionCards ? client.getDecisionCards(storeId) : Promise.resolve([]));
        case "AI":
          return () => (client.getAiStrategicReport ? client.getAiStrategicReport(storeId) : Promise.resolve(null));
        case "Chiến dịch":
          return () => client.getCampaignHierarchy(storeId);
        case "Đối thủ":
          return () => (client.getCompetitorIntelligence ? client.getCompetitorIntelligence(storeId) : Promise.resolve(null));
        case "Briefs":
          return () => (client.getBriefs ? client.getBriefs(storeId) : Promise.resolve([]));
        case "Thử nghiệm":
          return () => (client.getExperiments ? client.getExperiments(storeId) : Promise.resolve([]));
        default:
          return null;
      }
    },
    [client]
  );

  const applySourceValue = useCallback((name: string, val: unknown) => {
    switch (name) {
      case "Shopify":
        setShopifySummary(val as AdsShopifySummary | null);
        break;
      case "Meta":
        setSummary(val as AdsStoreSummary | null);
        break;
      case "Kết nối":
        setHealth(val as AdsDataHealth | null);
        break;
      case "Đối soát":
        setReconciliation(val as AdsReconciliationReport | null);
        break;
      case "Quyết định":
        setDecisions(val as readonly DecisionCard[]);
        break;
      case "AI":
        setAiReport(val as AiStrategicReport | null);
        break;
      case "Chiến dịch":
        setCampaigns(val as readonly AdsHierarchyCampaign[]);
        break;
      case "Đối thủ":
        setCompetitorReport(val as CompetitorIntelligenceReport | null);
        break;
      case "Briefs":
        setBriefs(val as readonly CreativeBrief[]);
        break;
      case "Thử nghiệm":
        setExperiments(val as readonly AdsExperiment[]);
        break;
    }
  }, []);

  const saveSourceToCache = useCallback((storeId: string, name: string, val: unknown) => {
    let record = storeCache.current.get(storeId);
    if (!record) {
      record = createEmptyStoreRecord();
      storeCache.current.set(storeId, record);
    }
    switch (name) {
      case "Shopify":
        record.shopifySummary = val as AdsShopifySummary | null;
        break;
      case "Meta":
        record.summary = val as AdsStoreSummary | null;
        break;
      case "Kết nối":
        record.health = val as AdsDataHealth | null;
        break;
      case "Đối soát":
        record.reconciliation = val as AdsReconciliationReport | null;
        break;
      case "Quyết định":
        record.decisions = val as readonly DecisionCard[];
        break;
      case "AI":
        record.aiReport = val as AiStrategicReport | null;
        break;
      case "Chiến dịch":
        record.campaigns = val as readonly AdsHierarchyCampaign[];
        break;
      case "Đối thủ":
        record.competitorReport = val as CompetitorIntelligenceReport | null;
        break;
      case "Briefs":
        record.briefs = val as readonly CreativeBrief[];
        break;
      case "Thử nghiệm":
        record.experiments = val as readonly AdsExperiment[];
        break;
    }
    record.loadedSources.add(name);
    delete record.sourceErrors[name];
    record.cachedAt = Date.now();
  }, []);

  const loadSource = useCallback(
    async (name: string, storeId: string, requestId: number): Promise<void> => {
      const fetcher = getSourceFetcher(name, storeId);
      if (!fetcher) return;
      try {
        const val = await fetcher();
        if (generation.current === requestId && activeStoreIdRef.current === storeId) {
          applySourceValue(name, val);
          saveSourceToCache(storeId, name, val);
          setSourceErrors((prev) => {
            if (!prev[name]) return prev;
            const next = { ...prev };
            delete next[name];
            return next;
          });
        }
      } catch (err) {
        if (generation.current === requestId && activeStoreIdRef.current === storeId) {
          const errMsg = err instanceof Error ? err.message : "Không lấy được dữ liệu.";
          setSourceErrors((prev) => ({ ...prev, [name]: errMsg }));
          const record = storeCache.current.get(storeId);
          if (record) {
            record.sourceErrors[name] = errMsg;
          }
        }
      }
    },
    [getSourceFetcher, applySourceValue, saveSourceToCache]
  );

  // Fetch store data with SWR and lazy tab loading
  const loadData = useCallback(
    async (storeId: string, options?: { force?: boolean }) => {
      const requestId = ++generation.current;
      if (options?.force) {
        storeCache.current.delete(storeId);
      }

      const cached = storeCache.current.get(storeId);
      if (cached && !options?.force) {
        // Hydrate from cache immediately (SWR: zero layout flash)
        setShopifySummary(cached.shopifySummary);
        setSummary(cached.summary);
        setCampaigns(cached.campaigns);
        setHealth(cached.health);
        setReconciliation(cached.reconciliation);
        setDecisions(cached.decisions);
        setAiReport(cached.aiReport);
        setCompetitorReport(cached.competitorReport);
        setBriefs(cached.briefs);
        setExperiments(cached.experiments);
        setSourceErrors(cached.sourceErrors);
        setLoading(false);
        setIsRevalidating(true);
      } else {
        setLoading(true);
        setIsRevalidating(false);
        setSourceErrors({});
        setShopifySummary(null);
        setSummary(null);
        setCampaigns([]);
        setHealth(null);
        setReconciliation(null);
        setDecisions([]);
        setAiReport(null);
        setCompetitorReport(null);
        setBriefs([]);
        setExperiments([]);
      }

      if (client.getLocalAiRunners) {
        void client
          .getLocalAiRunners()
          .then((res) => {
            if (res?.runners) setLocalAiRunners(res.runners);
          })
          .catch(() => {});
      }

      // Determine critical sources: CORE + currently active tab sources
      const tabSources = TAB_SOURCES[activeTab] || [];
      const sourcesToLoad = Array.from(new Set<string>([...CORE_SOURCES, ...tabSources]));

      await Promise.all(sourcesToLoad.map((name) => loadSource(name, storeId, requestId)));

      if (generation.current === requestId && activeStoreIdRef.current === storeId) {
        setLoading(false);
        setIsRevalidating(false);

        // Schedule idle prefetch for remaining tab sources and badge counts
        const remainingSources = ["Chiến dịch", "Briefs", "Thử nghiệm", "Đối thủ"].filter(
          (src) => !sourcesToLoad.includes(src)
        );
        if (remainingSources.length > 0) {
          window.setTimeout(() => {
            if (generation.current === requestId && activeStoreIdRef.current === storeId) {
              const currentRecord = storeCache.current.get(storeId);
              const unvisited = remainingSources.filter((src) => !currentRecord?.loadedSources.has(src));
              if (unvisited.length > 0) {
                void Promise.all(unvisited.map((src) => loadSource(src, storeId, requestId)));
              }
            }
          }, 1500);
        }
      }
    },
    [client, activeTab, loadSource]
  );

  useEffect(() => {
    void loadData(currentStoreId);
    return () => {
      generation.current++;
    };
  }, [currentStoreId, loadData]);

  // Load missing tab sources on-demand when active tab switches
  useEffect(() => {
    const requiredSources = TAB_SOURCES[activeTab] || [];
    if (requiredSources.length === 0) return;

    const record = storeCache.current.get(currentStoreId);
    const missing = requiredSources.filter((src) => !record?.loadedSources.has(src));
    if (missing.length === 0) return;

    const requestId = generation.current;
    void Promise.all(missing.map((src) => loadSource(src, currentStoreId, requestId)));
  }, [activeTab, currentStoreId, loadSource]);

  // Page visibility-aware Competitors polling
  useEffect(() => {
    if (activeTab !== "competitors" || !client.getCompetitorIntelligence) return;
    let isDisposed = false;
    let isFetching = false;
    let lastFetchedAt = Date.now();
    const refreshAds = async () => {
      if (isFetching || !client.getCompetitorIntelligence) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      isFetching = true;
      try {
        const report = await client.getCompetitorIntelligence(currentStoreId);
        if (!isDisposed && report.storeId === currentStoreId) {
          lastFetchedAt = Date.now();
          setCompetitorReport(report);
          saveSourceToCache(currentStoreId, "Đối thủ", report);
        }
      } catch {
        /* Preserve the last successfully loaded report; source errors are shown by loadData. */
      } finally {
        isFetching = false;
      }
    };
    void refreshAds();
    const handleVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible" && Date.now() - lastFetchedAt >= 15000) {
        void refreshAds();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
    const timer = window.setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void refreshAds();
      }
    }, 15000);
    return () => {
      isDisposed = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
      window.clearInterval(timer);
    };
  }, [activeTab, client, currentStoreId, saveSourceToCache]);

  // Actions
  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage("Đang gọi live Meta Graph API v26.0 & GA4 Data API...");
    try {
      if (client.syncNow) {
        const res = await client.syncNow(currentStoreId);
        setSyncMessage(res.message || "Đã đồng bộ dữ liệu mới nhất!");
      }
      await loadData(currentStoreId, { force: true });
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Đồng bộ thất bại.");
      await loadData(currentStoreId, { force: true });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 4000);
    }
  };

  const handleAiAnalyze = async (runner?: "codex" | "agy", model?: string) => {
    if (!client.getAiStrategicReport) return;
    setAiAnalyzing(true);
    try {
      const res = await client.getAiStrategicReport(currentStoreId, true, runner, model);
      setAiReport(res);
      setActionNotification(`✨ Đã hoàn tất phân tích với ${runner === "agy" ? "Antigravity CLI" : "Codex CLI"} (${res.modelUsed})!`);
    } catch {
      setActionNotification("Không thể phân tích AI: cần dữ liệu đã xác minh từ các nguồn.");
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
        await loadData(currentStoreId, { force: true });
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
        learning: {
          verdict,
          conclusion: learningNotes,
          scope: "CREATIVE_HOOK",
          nextRecommendedTest: "Cần xác minh số liệu trước khi đề xuất thử nghiệm tiếp theo.",
        },
      });
      setExperiments((prev) => prev.map((e) => (e.id === outcomeExperiment.id ? updated : e)));
      setOutcomeExperiment(null);
      setActionNotification(`Đã lưu nhận xét ${verdict}; chưa ghi nhận số liệu đo lường.`);
    } finally {
      setSavingOutcome(false);
    }
  };

  return (
    <div className="flex-1 bg-slate-950 p-4 sm:p-6 lg:p-8 text-slate-100 max-w-7xl mx-auto w-full space-y-5">
      {client.dataMode === "mock" && <p role="status" className="rounded border border-amber-600 p-3 text-amber-200">Chế độ dữ liệu mẫu — không phải số liệu kinh doanh thực.</p>}
      {/* 1. Header Command Bar */}
      <AdsHeader
        stores={stores}
        currentStoreId={currentStoreId}
        onStoreChange={handleStoreChange}
        summary={summary}
        syncing={syncing}
        syncMessage={syncMessage}
        onSync={handleSync}
        onOpenMcp={() => setShowMcpModal(true)}
        onOpenProfile={() => setShowProfileModal(true)}
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

      {/* Quick Setup Card for Unconfigured Store */}
      {Object.values(sourceErrors).some(msg => msg.includes("ADS_PROFILE_NOT_CONFIGURED") || msg.includes("chưa cấu hình riêng Meta/GA4")) && (
        <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950/50 via-slate-900/90 to-indigo-950/50 p-5 shadow-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
              <span>🚀</span> Kích hoạt Ads Intelligence cho store <span className="font-mono text-white underline">{currentStoreId}</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
              Store này đã kết nối Shopify nhưng chưa có cấu hình riêng cho Meta Ads / GA4. Bạn có thể nhập nhanh ID tài khoản hoặc tải lên file JSON để hệ thống tự động kết nối và xem báo cáo ngay tại đây.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs shadow-lg shadow-cyan-500/25 transition cursor-pointer flex items-center gap-2 active:scale-95"
          >
            <span>⚙️</span>
            <span>Cấu hình ngay</span>
          </button>
        </div>
      )}

      {Object.keys(sourceErrors).length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200">
          <p>Store {currentStoreId}: một số nguồn chưa có dữ liệu xác minh. Không dùng dữ liệu mẫu thay thế.</p>
          <ul className="mt-2 space-y-1">{Object.entries(sourceErrors).map(([source, message]) => <li key={source}>{source}: {message}</li>)}</ul>
        </div>
      )}
      {loading && <p role="status" className="text-xs text-slate-400">Đang tải dữ liệu…</p>}
      {!loading && isRevalidating && <p role="status" className="text-[11px] text-cyan-400/80 animate-pulse">⚡ Đang làm mới dữ liệu nền…</p>}
      {summary && <p className="text-xs text-slate-400">Kỳ Meta: {summary.periodStart} → {summary.periodEnd} · {summary.timezone} · {summary.currency}</p>}
      {summary?.warnings.map(warning => <p key={warning} className="text-xs text-amber-300">{warning}</p>)}
      {reconciliation && <p className="text-xs text-slate-400">{reconciliation.shopify.source}</p>}
      {/* 2. Unified Executive KPI Ribbon (3 Clusters) */}
      {!reconciliation && shopifySummary && <p className="text-xs text-slate-400">Shopify độc lập (chưa đối soát): {shopifySummary.source}</p>}
      {(reconciliation?.shopify.totalOrders ?? shopifySummary?.totalOrders) === 0 && <p className="text-xs text-amber-300">Không có đơn Shopify đủ điều kiện trong kỳ đang hiển thị. Số 0 không có nghĩa store chưa từng có đơn.</p>}
      <ExecutiveKpiRibbon summary={summary} reconciliation={reconciliation} shopifySummary={shopifySummary} />

      {/* 3. Streamlined Tabs Navigation */}
      <div className="flex border-b border-slate-800 gap-2 overflow-x-auto whitespace-nowrap">
        {[
          { id: "decisions", label: "🎯 Quyết định & Đề xuất", badge: loading || sourceErrors["Quyết định"] ? null : decisions.length },
          { id: "hierarchy", label: "📊 Chiến dịch & Ads", badge: loading || sourceErrors["Chiến dịch"] ? null : (campaigns.length || null) },
          { id: "funnel", label: "🔄 Phễu & Đối soát", badge: null },
          { id: "competitors", label: "🕵️ Spy Đối thủ", badge: null },
          { id: "experiments", label: "🧪 Briefs & Thử nghiệm", badge: loading || sourceErrors["Briefs"] ? null : (briefs.length || null) },
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
      {
        <div>
          {activeTab === "decisions" && (
            <DecisionsTab
              decisions={decisions}
              aiReport={aiReport}
              aiAnalyzing={aiAnalyzing}
              localAiRunners={localAiRunners}
              onRunAiAnalysis={handleAiAnalyze}
              onSelectCard={(card) => setSelectedDrawerCard(card)}
              onTriggerGuardedWrite={undefined}
              onCreateBrief={handleCreateBriefFromDecision}
            />
          )}

          {activeTab === "hierarchy" && <HierarchyTab campaigns={campaigns} />}

          {activeTab === "funnel" && <FunnelTab reconciliation={reconciliation} summary={summary} />}

          {activeTab === "competitors" && (
            <CompetitorsTab
              key={currentStoreId}
              storeId={currentStoreId}
              client={client}
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
              onOpenOutcomeModal={() => setActionNotification("Nhập kết quả đo lường chưa khả dụng; hệ thống không tự điền số thử nghiệm.")}
            />
          )}

          {activeTab === "health" && (
            <SystemHealthTab health={health} shopifySummary={shopifySummary} onSync={() => { void loadData(currentStoreId, { force: true }); }} />
          )}
        </div>
      }

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

      {showMcpModal && <McpModal client={client} stores={stores} onClose={() => setShowMcpModal(false)} />}

      {showProfileModal && (
        <StoreProfileModal
          storeId={currentStoreId}
          shopDomain={stores.find(s => s.storeId === currentStoreId)?.shopDomain}
          client={client}
          onClose={() => setShowProfileModal(false)}
          onSaved={(savedStoreId) => {
            setActionNotification(`✅ Đã lưu cấu hình Ads cho store ${savedStoreId} thành công! Đang kết nối dữ liệu trực tiếp...`);
            void loadData(savedStoreId, { force: true });
          }}
        />
      )}

      <ExperimentOutcomeModal
        experiment={outcomeExperiment}
        saving={savingOutcome}
        onClose={() => setOutcomeExperiment(null)}
        onSave={handleSaveExperimentOutcome}
      />
    </div>
  );
}
