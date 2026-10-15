import { useMemo, useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { ThemeCluster, TrendDiscoveryResult, TrendingKeywordItem } from "../../types";

export interface TrendClusterDiscoveryProps {
  readonly result?: TrendDiscoveryResult;
  readonly discoveryResult?: TrendDiscoveryResult;
  readonly selectedClusterIds: ReadonlySet<string>;
  readonly onToggleCluster: (clusterId: string) => void;
  readonly onSelectAllClusters: () => void;
  readonly onDeselectAllClusters?: () => void;
  readonly onStartCrawlWithClusters: (
    selectedClusters: readonly ThemeCluster[],
    restoredKeywords?: readonly TrendingKeywordItem[],
    selectedCustomKeywords?: readonly TrendingKeywordItem[],
  ) => void;
  readonly onClose?: () => void;
  readonly isCrawling?: boolean;
}

export function TrendClusterDiscovery({
  result,
  discoveryResult,
  selectedClusterIds,
  onToggleCluster,
  onSelectAllClusters,
  onDeselectAllClusters,
  onStartCrawlWithClusters,
  onClose,
  isCrawling = false,
}: TrendClusterDiscoveryProps): React.JSX.Element {
  const activeResult = discoveryResult ?? result;
  const [showRejected, setShowRejected] = useState(false);
  const [restoredKeywords, setRestoredKeywords] = useState<readonly TrendingKeywordItem[]>([]);
  const [activeTab, setActiveTab] = useState<"clusters" | "keywords">("clusters");
  const [keywordSearch, setKeywordSearch] = useState("");
  const [keywordFilter, setKeywordFilter] = useState<"all" | "global" | "high_growth">("all");
  const [selectedKeywordNames, setSelectedKeywordNames] = useState<Set<string>>(new Set());

  // Extract all accepted keywords safely
  const allAcceptedKeywords: readonly TrendingKeywordItem[] = useMemo(() => {
    if (!activeResult) return [];
    if (activeResult.accepted_keywords && activeResult.accepted_keywords.length > 0) {
      return activeResult.accepted_keywords;
    }
    if (activeResult.all_keywords && activeResult.all_keywords.length > 0) {
      return activeResult.all_keywords.filter((k) => k.is_accepted !== false);
    }
    const seen = new Set<string>();
    const list: TrendingKeywordItem[] = [];
    for (const c of activeResult.clusters) {
      for (const kw of c.keywords ?? []) {
        if (!seen.has(kw.keyword)) {
          seen.add(kw.keyword);
          list.push(kw);
        }
      }
    }
    return list;
  }, [activeResult]);

  // Filtered keywords in the individual keywords tab
  const filteredKeywords = useMemo(() => {
    return allAcceptedKeywords.filter((item) => {
      if (keywordSearch.trim()) {
        const query = keywordSearch.trim().toLowerCase();
        if (!item.keyword.toLowerCase().includes(query)) return false;
      }
      if (keywordFilter === "global") {
        return (item.markets?.length ?? 0) > 1;
      }
      if (keywordFilter === "high_growth") {
        return (item.pct_growth_mom ?? 0) >= 50;
      }
      return true;
    });
  }, [allAcceptedKeywords, keywordSearch, keywordFilter]);

  if (!activeResult) {
    return <></>;
  }

  const selectedClusters = activeResult.clusters.filter((c) =>
    selectedClusterIds.has(c.cluster_id || c.id || ""),
  );

  const selectedCustomKeywords = allAcceptedKeywords.filter((k) =>
    selectedKeywordNames.has(k.keyword),
  );

  const hasSelection =
    selectedClusters.length > 0 ||
    selectedCustomKeywords.length > 0 ||
    restoredKeywords.length > 0;

  const handleRestoreKeyword = (kw: TrendingKeywordItem): void => {
    if (restoredKeywords.some((k) => k.keyword === kw.keyword)) return;
    setRestoredKeywords((prev) => [...prev, { ...kw, is_accepted: true, reject_reason: undefined }]);
  };

  const handleToggleSelectAllClusters = (): void => {
    if (selectedClusterIds.size === activeResult.clusters.length && onDeselectAllClusters) {
      onDeselectAllClusters();
    } else {
      onSelectAllClusters();
    }
  };

  const handleToggleKeyword = (kwName: string): void => {
    setSelectedKeywordNames((prev) => {
      const next = new Set(prev);
      if (next.has(kwName)) {
        next.delete(kwName);
      } else {
        next.add(kwName);
      }
      return next;
    });
  };

  const handleSelectTop10Keywords = (): void => {
    const top10 = filteredKeywords.slice(0, 10).map((k) => k.keyword);
    setSelectedKeywordNames((prev) => new Set([...prev, ...top10]));
  };

  const handleSelectTop25Keywords = (): void => {
    const top25 = filteredKeywords.slice(0, 25).map((k) => k.keyword);
    setSelectedKeywordNames((prev) => new Set([...prev, ...top25]));
  };

  const handleClearKeywordSelection = (): void => {
    setSelectedKeywordNames(new Set());
  };

  const acceptedCount =
    activeResult.accepted_count ??
    allAcceptedKeywords.length ??
    activeResult.clusters.reduce((acc, c) => acc + (c.keywords?.length ?? 0), 0);
  const rejectedCount = activeResult.rejected_count ?? activeResult.rejected_keywords.length;
  const productLabel = (activeResult.product ?? "custom").toUpperCase();
  const regionLabel = activeResult.region ?? "US";
  const isOfficialTrendData = activeResult.isOfficialTrendData;

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl"><AppIcon name="seo" /></span>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {isOfficialTrendData ? "Pinterest Trends chính thức & Cụm Chủ đề" : "Gợi ý Chủ đề POD nội bộ"}
            </h2>
            <span className="rounded-full bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 text-xs font-bold text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
              {activeResult.clusters.length} Cụm đề xuất
            </span>
            <span className="rounded-full bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 text-xs font-bold text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
              {allAcceptedKeywords.length} {isOfficialTrendData ? "Từ khóa Trends" : "Từ khóa gợi ý"}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {isOfficialTrendData ? "Đã phân tích dữ liệu Pinterest Trends chính thức" : "Đây là gợi ý nội bộ, không phải dữ liệu Pinterest Trends"} cho niche &quot;
            <span className="text-blue-700 dark:text-blue-300 font-semibold">{activeResult.niche}</span>
            &quot; và nhóm thành các phong cách in ấn thương mại cao. Bạn có thể chọn theo Cụm Chủ đề hoặc chọn trực tiếp từng Từ khóa lẻ.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {activeTab === "clusters" && (
            <button
              type="button"
              onClick={handleToggleSelectAllClusters}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
            >
              {selectedClusterIds.size === activeResult.clusters.length ? "Bỏ chọn tất cả" : "Chọn tất cả cụm"}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
            >
              ✕ Đóng
            </button>
          )}
        </div>
      </div>

      {/* Multi-Query Matrix Global Stats Banner */}
      {isOfficialTrendData && activeResult.query_matrix_stats && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-3.5 text-xs shadow-inner">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-800 px-2.5 py-1 text-blue-700 dark:text-blue-300 font-bold flex items-center gap-1.5">
                <span><AppIcon name="play" /> Quét Ma trận Toàn cầu:</span>
                <span className="text-slate-900 dark:text-slate-100">{activeResult.query_matrix_stats.successful_queries}/{activeResult.query_matrix_stats.total_queries} queries thành công</span>
              </span>
              <span className="rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-slate-700 dark:text-slate-300">
                <AppIcon name="chart" /> <strong>{activeResult.query_matrix_stats.raw_keywords_count}</strong> từ khóa thô → <strong>{activeResult.query_matrix_stats.unique_keywords_count ?? activeResult.total_keywords}</strong> từ khóa độc nhất
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Thị trường:</span>
              {activeResult.query_matrix_stats.markets.map((m) => (
                <span key={m} className="rounded bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-bold text-blue-700 dark:text-blue-300 border border-slate-300 dark:border-slate-700">
                  {m === "US" ? "🇺🇸 US" : m === "CA" ? "🇨🇦 CA" : m === "DE" ? "🇩🇪 DE" : m === "FR" ? "🇫🇷 FR" : m === "ES" ? "🇪🇸 ES" : m === "IT" ? "🇮🇹 IT" : m === "GB" ? "🇬🇧 GB" : m === "AU" ? "🇦🇺 AU" : m}
                </span>
              ))}
              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium ml-1">Xu hướng:</span>
              {activeResult.query_matrix_stats.trend_types.map((t) => (
                <span key={t} className="rounded bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 text-xs font-bold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {t === "growing" ? "🔥 Tăng trưởng" : t === "monthly" ? "📅 Hàng tháng" : t === "seasonal" ? "🍂 Mùa vụ" : t}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Summary Chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-slate-700 dark:text-slate-300 font-medium">
          <AppIcon name="ads" /> Niche: <strong className="text-blue-700 dark:text-blue-300">{activeResult.niche}</strong>
        </span>
        <span className="rounded-md bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-slate-700 dark:text-slate-300 font-medium">
          <AppIcon name="folder" /> Phôi: <strong className="text-blue-700 dark:text-blue-300">{productLabel}</strong>
        </span>
        <span className="rounded-md bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-slate-700 dark:text-slate-300 font-medium">
          🌍 Thị trường: <strong className="text-slate-900 dark:text-slate-100">{regionLabel}</strong>
        </span>
        <span className="rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 text-emerald-700 dark:text-emerald-300 font-semibold">
          ✓ {acceptedCount} Từ khóa đạt chuẩn in ấn
        </span>
        <span className="rounded-md bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 px-2.5 py-1 text-rose-700 dark:text-rose-300 font-semibold">
          ✕ {rejectedCount} Đã loại qua Printability Gate
        </span>
      </div>

      {/* Two View Modes: Clusters vs Individual Keywords */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("clusters")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition cursor-pointer ${
              activeTab === "clusters"
                ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 shadow"
                : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-300 dark:border-slate-700"
            }`}
          >
            <span>🗂️ 1. Chọn theo Cụm Chủ đề AI</span>
            <span className="rounded-full bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300 font-mono">
              {activeResult.clusters.length} Cụm
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("keywords")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition cursor-pointer ${
              activeTab === "keywords"
                ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 shadow"
                : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-300 dark:border-slate-700"
            }`}
          >
            <span><AppIcon name="queue" /> 2. Chọn trực tiếp từ {allAcceptedKeywords.length} Từ khóa Đạt chuẩn</span>
            {selectedKeywordNames.size > 0 && (
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white font-mono font-bold">
                ✓ {selectedKeywordNames.size} đã chọn
              </span>
            )}
          </button>
        </div>

        {activeTab === "clusters" ? (
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span>Đã chọn: <strong className="text-blue-700 dark:text-blue-300">{selectedClusters.length}</strong> / {activeResult.clusters.length} cụm</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSelectTop10Keywords}
              className="rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/80 transition cursor-pointer"
            >
              <AppIcon name="seo" /> {isOfficialTrendData ? "Chọn Top 10 Hot" : "Chọn 10 gợi ý đầu"}
            </button>
            <button
              type="button"
              onClick={handleSelectTop25Keywords}
              className="rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/80 transition cursor-pointer"
            >
              <AppIcon name="seo" /> {isOfficialTrendData ? "Chọn Top 25 Hot" : "Chọn 25 gợi ý đầu"}
            </button>
            {selectedKeywordNames.size > 0 && (
              <button
                type="button"
                onClick={handleClearKeywordSelection}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
              >
                Bỏ chọn từ khóa
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mode 1: Theme Clusters Cards */}
      {activeTab === "clusters" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {activeResult.clusters.map((cluster) => {
            const clusterId = cluster.cluster_id || cluster.id || "";
            const isSelected = selectedClusterIds.has(clusterId);
            const title = cluster.theme_name_vi || cluster.theme_name || cluster.cluster_name || "Cụm xu hướng";
            const englishTitle = cluster.theme_name || cluster.cluster_name || "";
            const growthMom = cluster.growth_mom_avg ?? cluster.avg_growth_mom;
            const sampleMotifs = cluster.sample_motifs ?? [];
            const fusedQueries = cluster.fused_queries ?? cluster.sample_queries ?? [];
            const visualStyle = cluster.visual_style ?? "Tone màu hài hòa, nét vẽ vector phẳng chuẩn xưởng";

            return (
              <div
                key={clusterId}
                onClick={() => onToggleCluster(clusterId)}
                className={`flex flex-col gap-3 rounded-lg border p-4 cursor-pointer transition ${
                  isSelected
                    ? "border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 shadow-sm ring-1 ring-blue-300 dark:ring-blue-400"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
                }`}
              >
                {/* Header with Checkbox and Names */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleCluster(clusterId)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 h-4 w-4 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 focus:ring-blue-300 dark:focus:ring-blue-400 focus:ring-offset-0 cursor-pointer"
                    />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
                        {cluster.recommended && (
                          <span className="rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 px-2 py-0.2 text-xs font-bold text-amber-700 dark:text-amber-300">
                            <AppIcon name="star" /> Đề xuất cao
                          </span>
                        )}
                      </div>
                      {englishTitle && (
                        <span className="text-xs text-slate-600 dark:text-slate-400 italic font-mono">
                          {englishTitle}
                        </span>
                      )}
                    </div>
                  </div>

                  {isOfficialTrendData && growthMom !== undefined && (
                    <span className="rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                      +{growthMom}% MoM
                    </span>
                  )}
                </div>

                {/* Description */}
                {cluster.description && (
                  <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2 leading-relaxed">
                    {cluster.description}
                  </p>
                )}

                {/* Visual Style Note */}
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-blue-700 dark:text-blue-300"><AppIcon name="image" /> Phong cách in: </span>
                  <span>{visualStyle}</span>
                </div>

                {/* Sample Motifs */}
                {sampleMotifs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Họa tiết tiêu biểu:</span>
                    {sampleMotifs.map((motif: string) => (
                      <span
                        key={motif}
                        className="rounded bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700"
                      >
                        {motif}
                      </span>
                    ))}
                  </div>
                )}

                {/* Cluster Keywords with Market & Growth Badges */}
                {cluster.keywords && cluster.keywords.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-slate-200 dark:border-slate-700 pt-2">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 font-medium">
                      <span>Từ khóa xu hướng trong cụm ({cluster.keywords.length}):</span>
                      <span>Thị trường & Loại xu hướng</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {cluster.keywords.slice(0, 5).map((kw) => (
                        <div
                          key={kw.keyword}
                          className="flex items-center gap-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-xs text-slate-900 dark:text-slate-100"
                        >
                          <span className="font-medium truncate max-w-[140px]">{kw.keyword}</span>
                          {kw.markets && kw.markets.length > 1 && (
                            <span className="rounded bg-amber-50 dark:bg-amber-950/60 px-1 text-xs font-bold text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                              🌍 {kw.markets.length} QG
                            </span>
                          )}
                          {kw.markets && kw.markets.length === 1 && (
                            <span className="rounded bg-slate-50 dark:bg-slate-800 px-1 text-xs font-bold text-blue-700 dark:text-blue-300">
                              {kw.markets[0]}
                            </span>
                          )}
                          {kw.pct_growth_mom !== undefined && (
                            <span className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
                              +{kw.pct_growth_mom}%
                            </span>
                          )}
                        </div>
                      ))}
                      {cluster.keywords.length > 5 && (
                        <span className="text-xs text-slate-600 dark:text-slate-400 self-center">
                          +{cluster.keywords.length - 5} từ khóa khác...
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Fused 2D Pattern Queries */}
                {fusedQueries.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-slate-200 dark:border-slate-700 pt-2.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                      <AppIcon name="seo" /> Câu truy vấn cào ảnh hoa văn 2D (Fused Queries):
                    </span>
                    <div className="flex flex-col gap-1">
                      {fusedQueries.map((q: string) => (
                        <div
                          key={q}
                          className="flex items-center gap-1.5 text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 truncate"
                        >
                          <span className="text-blue-700 dark:text-blue-300">→</span>
                          <span className="truncate">{q}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mode 2: Direct Keyword Selection Table / Grid */}
      {activeTab === "keywords" && (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
          {/* Keyword Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 dark:text-slate-400 text-xs">
                <AppIcon name="search" />
              </span>
              <input
                type="text"
                value={keywordSearch}
                onChange={(e) => setKeywordSearch(e.target.value)}
                placeholder="Tìm kiếm từ khóa trong danh sách đạt chuẩn..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
              />
              {keywordSearch && (
                <button
                  type="button"
                  onClick={() => setKeywordSearch("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setKeywordFilter("all")}
                className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
                  keywordFilter === "all"
                    ? "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-bold"
                    : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                }`}
              >
                Tất cả ({allAcceptedKeywords.length})
              </button>
              {isOfficialTrendData && <button
                type="button"
                onClick={() => setKeywordFilter("global")}
                className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
                  keywordFilter === "global"
                    ? "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold"
                    : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                }`}
              >
                🌍 Đa quốc gia ({allAcceptedKeywords.filter((k) => (k.markets?.length ?? 0) > 1).length})
              </button>}
              {isOfficialTrendData && <button
                type="button"
                onClick={() => setKeywordFilter("high_growth")}
                className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
                  keywordFilter === "high_growth"
                    ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold"
                    : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                }`}
              >
                🔥 Tăng &gt; 50% ({allAcceptedKeywords.filter((k) => (k.pct_growth_mom ?? 0) >= 50).length})
              </button>}
            </div>
          </div>

          {/* Grid of Keywords */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[480px] overflow-y-auto pr-1">
            {filteredKeywords.slice(0, 150).map((kw, idx) => {
              const isChecked = selectedKeywordNames.has(kw.keyword);
              const fusedQ = kw.suggested_fused_query || `${kw.keyword} seamless pattern vector`;
              return (
                <div
                  key={kw.keyword}
                  onClick={() => handleToggleKeyword(kw.keyword)}
                  className={`flex flex-col gap-1.5 rounded-lg border p-2.5 transition cursor-pointer ${
                    isChecked
                      ? "border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-400 shadow"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleKeyword(kw.keyword)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 focus:ring-blue-300 dark:focus:ring-blue-400 cursor-pointer"
                      />
                      <span className="font-semibold text-xs truncate" title={kw.keyword}>
                        {kw.keyword}
                      </span>
                    </div>

                    {kw.pct_growth_mom !== undefined && (
                      <span className="rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.2 text-xs font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                        +{kw.pct_growth_mom}%
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1 truncate">
                      <span className="text-slate-500 dark:text-slate-400 font-mono">#{kw.rank ?? idx + 1}</span>
                      {kw.markets && kw.markets.length > 0 && (
                        <span className="rounded bg-slate-50 dark:bg-slate-800 px-1 py-0.2 font-mono text-blue-700 dark:text-blue-300">
                          {kw.markets.slice(0, 3).join(", ")}
                          {kw.markets.length > 3 ? ` +${kw.markets.length - 3}` : ""}
                        </span>
                      )}
                    </div>

                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate max-w-[120px]" title={fusedQ}>
                      → {fusedQ}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredKeywords.length > 150 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center italic">
              Đang hiển thị 150 / {filteredKeywords.length} từ khóa phù hợp. Sử dụng ô tìm kiếm để lọc chính xác từ bạn muốn.
            </p>
          )}

          {filteredKeywords.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Không tìm thấy từ khóa nào phù hợp với bộ lọc tìm kiếm.
            </div>
          )}
        </div>
      )}

      {/* Restored Keywords Notice if any */}
      {restoredKeywords.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          <div className="flex items-center gap-2">
            <span><AppIcon name="seo" /></span>
            <span>
              Đã khôi phục <strong>{restoredKeywords.length}</strong> từ khóa bị loại vào danh sách tìm kiếm:
            </span>
            <span className="font-mono">{restoredKeywords.map((k) => k.keyword).join(", ")}</span>
          </div>
        </div>
      )}

      {/* Transparent Graphic Printability Gate Section (Rejected Keywords) */}
      <div className="flex flex-col rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setShowRejected((prev) => !prev)}
          className="flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span><AppIcon name="lock" /></span>
            <span>Minh bạch Bộ lọc Ấn phẩm (Graphic Printability Gate):</span>
            <span className="rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 px-2 py-0.5 text-xs font-bold text-rose-700 dark:text-rose-300">
              {activeResult.rejected_keywords.length} Từ khóa không phù hợp đã loại bỏ
            </span>
          </div>
          <span className="text-slate-600 dark:text-slate-400 text-xs font-bold">
            {showRejected ? "▲ Thu gọn" : "▼ Xem danh sách & Khôi phục"}
          </span>
        </button>

        {showRejected && (
          <div className="flex flex-col gap-2 border-t border-slate-200 dark:border-slate-700 p-4 pt-3">
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Bộ lọc Printability Gate tự động chặn các từ khóa công thức nấu ăn, làm đẹp móng tay, không gian kiến trúc 3D
              và bài tập thể hình để đảm bảo 100% kết quả cào về là hoa văn, tranh vẽ vector, typography chữ nghệ thuật
              và hình nền đồ họa chuẩn xưởng in ấn POD.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              {activeResult.rejected_keywords.map((kw) => (
                <div
                  key={kw.keyword}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs"
                >
                  <div className="flex flex-col gap-0.5 truncate">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate line-through opacity-80">
                        {kw.keyword}
                      </span>
                      {kw.markets && kw.markets.length > 1 && (
                        <span className="rounded bg-slate-50 dark:bg-slate-800 px-1 text-[8px] font-bold text-amber-700 dark:text-amber-300">
                          {kw.markets.length} QG
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-rose-700 dark:text-rose-300 truncate">
                        {kw.reject_reason || "Từ khóa phi ấn phẩm"}
                      </span>
                      {kw.markets && kw.markets.length > 0 && (
                        <span className="rounded bg-slate-50 dark:bg-slate-800 px-1 text-[8px] text-slate-600 dark:text-slate-400 font-mono">
                          {kw.markets.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRestoreKeyword(kw)}
                    className="shrink-0 rounded bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/80 border border-slate-300 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-800 px-2 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 transition cursor-pointer"
                  >
                    <AppIcon name="seo" /> Khôi phục
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-700 pt-4">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={isCrawling}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition disabled:opacity-50 cursor-pointer"
          >
            Quay lại form nhập
          </button>
        )}

        <div className="flex items-center gap-3 ml-auto">
          <div className="text-right text-xs text-slate-600 dark:text-slate-400 hidden sm:block">
            <span>Đang chọn: </span>
            <strong className="text-blue-700 dark:text-blue-300">{selectedClusters.length} cụm</strong>
            {selectedCustomKeywords.length > 0 && (
              <>
                {" + "}
                <strong className="text-blue-700 dark:text-blue-300">{selectedCustomKeywords.length} từ khóa lẻ</strong>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => onStartCrawlWithClusters(selectedClusters, restoredKeywords, selectedCustomKeywords)}
            disabled={isCrawling || !hasSelection}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <span><AppIcon name="play" /></span>
            <span>
              {isCrawling
                ? "Đang cào dữ liệu theo lựa chọn..."
                : `Tiến hành cào mẫu (${selectedClusters.length} cụm${selectedCustomKeywords.length > 0 ? ` + ${selectedCustomKeywords.length} từ khóa` : ""})`}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
