import { useState } from "react";
import type { ThemeCluster, TrendDiscoveryResult, TrendingKeywordItem } from "../../types";

export interface TrendClusterDiscoveryProps {
  readonly result?: TrendDiscoveryResult;
  readonly discoveryResult?: TrendDiscoveryResult;
  readonly selectedClusterIds: ReadonlySet<string>;
  readonly onToggleCluster: (clusterId: string) => void;
  readonly onSelectAllClusters: () => void;
  readonly onDeselectAllClusters?: () => void;
  readonly onStartCrawlWithClusters: (selectedClusters: readonly ThemeCluster[]) => void;
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

  if (!activeResult) {
    return <></>;
  }

  const selectedClusters = activeResult.clusters.filter((c) =>
    selectedClusterIds.has(c.cluster_id || c.id || ""),
  );
  const hasSelection = selectedClusters.length > 0;

  const handleRestoreKeyword = (kw: TrendingKeywordItem): void => {
    if (restoredKeywords.some((k) => k.keyword === kw.keyword)) return;
    setRestoredKeywords((prev) => [...prev, { ...kw, is_accepted: true, reject_reason: undefined }]);
  };

  const handleToggleSelectAll = (): void => {
    if (selectedClusterIds.size === activeResult.clusters.length && onDeselectAllClusters) {
      onDeselectAllClusters();
    } else {
      onSelectAllClusters();
    }
  };

  const acceptedCount =
    activeResult.accepted_count ??
    activeResult.accepted_keywords?.length ??
    activeResult.clusters.reduce((acc, c) => acc + (c.keywords?.length ?? 0), 0);
  const rejectedCount = activeResult.rejected_count ?? activeResult.rejected_keywords.length;
  const productLabel = (activeResult.product ?? "custom").toUpperCase();
  const regionLabel = activeResult.region ?? "US";

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-cyan-800/60 bg-slate-900 p-5 shadow-2xl">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✨</span>
            <h2 className="text-lg font-bold text-slate-100">
              Khám phá Xu hướng & Cụm Chủ đề AI (Tier 1 & 2)
            </h2>
            <span className="rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-xs font-bold text-cyan-300 border border-cyan-500/30">
              {activeResult.clusters.length} Cụm đề xuất
            </span>
          </div>
          <p className="text-xs text-slate-400">
            AI đã phân tích {activeResult.total_keywords} từ khóa Pinterest xung quanh niche &quot;
            <span className="text-cyan-300 font-semibold">{activeResult.niche}</span>
            &quot; và nhóm thành các phong cách in ấn thương mại cao.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleSelectAll}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
          >
            {selectedClusterIds.size === activeResult.clusters.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition cursor-pointer"
            >
              ✕ Đóng
            </button>
          )}
        </div>
      </div>

      {/* Summary Chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-slate-800 px-2.5 py-1 text-slate-300 font-medium">
          🎯 Niche: <strong className="text-cyan-300">{activeResult.niche}</strong>
        </span>
        <span className="rounded-md bg-slate-800 px-2.5 py-1 text-slate-300 font-medium">
          📦 Phôi: <strong className="text-cyan-300">{productLabel}</strong>
        </span>
        <span className="rounded-md bg-slate-800 px-2.5 py-1 text-slate-300 font-medium">
          🌍 Thị trường: <strong className="text-slate-200">{regionLabel}</strong>
        </span>
        <span className="rounded-md bg-emerald-950/60 border border-emerald-800/40 px-2.5 py-1 text-emerald-300 font-semibold">
          ✓ {acceptedCount} Từ khóa đạt chuẩn in ấn
        </span>
        <span className="rounded-md bg-rose-950/60 border border-rose-800/40 px-2.5 py-1 text-rose-300 font-semibold">
          ✕ {rejectedCount} Đã loại qua Printability Gate
        </span>
      </div>

      {/* 3-5 Theme Clusters Cards */}
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
              className={`flex flex-col gap-3 rounded-xl border p-4 cursor-pointer transition ${
                isSelected
                  ? "border-cyan-500 bg-cyan-950/30 shadow-lg shadow-cyan-950/50 ring-1 ring-cyan-500/40"
                  : "border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900/60"
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
                    className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-400 focus:ring-offset-0 cursor-pointer"
                  />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-100">{title}</h3>
                      {cluster.recommended && (
                        <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.2 text-[10px] font-bold text-amber-300">
                          ⭐ Đề xuất cao
                        </span>
                      )}
                    </div>
                    {englishTitle && (
                      <span className="text-xs text-slate-400 italic font-mono">
                        {englishTitle}
                      </span>
                    )}
                  </div>
                </div>

                {growthMom !== undefined && (
                  <span className="rounded-lg bg-emerald-950/70 border border-emerald-600/40 px-2.5 py-1 text-xs font-bold text-emerald-300 shrink-0">
                    +{growthMom}% MoM
                  </span>
                )}
              </div>

              {/* Description */}
              {cluster.description && (
                <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                  {cluster.description}
                </p>
              )}

              {/* Visual Style Note */}
              <div className="rounded-lg bg-slate-900/90 border border-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
                <span className="font-semibold text-cyan-300">🎨 Phong cách in: </span>
                <span>{visualStyle}</span>
              </div>

              {/* Sample Motifs */}
              {sampleMotifs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-medium text-slate-400">Họa tiết tiêu biểu:</span>
                  {sampleMotifs.map((motif: string) => (
                    <span
                      key={motif}
                      className="rounded bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-300 border border-slate-700/60"
                    >
                      {motif}
                    </span>
                  ))}
                </div>
              )}

              {/* Fused 2D Pattern Queries */}
              {fusedQueries.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-slate-800/80 pt-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400/90">
                    ⚡ Câu truy vấn cào ảnh hoa văn 2D (Fused Queries):
                  </span>
                  <div className="flex flex-col gap-1">
                    {fusedQueries.map((q: string) => (
                      <div
                        key={q}
                        className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800 truncate"
                      >
                        <span className="text-cyan-400">→</span>
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

      {/* Restored Keywords Notice if any */}
      {restoredKeywords.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-600/40 bg-emerald-950/20 p-3 text-xs text-emerald-300">
          <div className="flex items-center gap-2">
            <span>⚡</span>
            <span>
              Đã khôi phục <strong>{restoredKeywords.length}</strong> từ khóa bị loại vào danh sách tìm kiếm:
            </span>
            <span className="font-mono">{restoredKeywords.map((k) => k.keyword).join(", ")}</span>
          </div>
        </div>
      )}

      {/* Transparent Graphic Printability Gate Section (Rejected Keywords) */}
      <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/60">
        <button
          type="button"
          onClick={() => setShowRejected((prev) => !prev)}
          className="flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span>🛡️</span>
            <span>Minh bạch Bộ lọc Ấn phẩm (Graphic Printability Gate):</span>
            <span className="rounded bg-rose-950/80 border border-rose-800/60 px-2 py-0.5 text-[10px] font-bold text-rose-300">
              {activeResult.rejected_keywords.length} Từ khóa không phù hợp đã loại bỏ
            </span>
          </div>
          <span className="text-slate-400 text-xs font-bold">
            {showRejected ? "▲ Thu gọn" : "▼ Xem danh sách & Khôi phục"}
          </span>
        </button>

        {showRejected && (
          <div className="flex flex-col gap-2 border-t border-slate-800 p-4 pt-3">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Bộ lọc Printability Gate tự động chặn các từ khóa công thức nấu ăn, làm đẹp móng tay, không gian kiến trúc 3D,
              hình nền điện thoại và meme chữ để đảm bảo 100% kết quả cào về là hoa văn, tranh vẽ và phôi in ấn chuẩn xưởng.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              {activeResult.rejected_keywords.map((kw) => (
                <div
                  key={kw.keyword}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2.5 text-xs"
                >
                  <div className="flex flex-col gap-0.5 truncate">
                    <span className="font-medium text-slate-200 truncate line-through opacity-80">
                      {kw.keyword}
                    </span>
                    <span className="text-[10px] text-rose-400 truncate">
                      {kw.reject_reason || "Từ khóa phi ấn phẩm"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRestoreKeyword(kw)}
                    className="shrink-0 rounded bg-slate-800 hover:bg-cyan-900/60 border border-slate-700 hover:border-cyan-500 px-2 py-1 text-[10px] font-semibold text-cyan-300 transition cursor-pointer"
                  >
                    ⚡ Khôi phục
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={isCrawling}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition disabled:opacity-50 cursor-pointer"
          >
            Quay lại form nhập
          </button>
        )}

        <button
          type="button"
          onClick={() => onStartCrawlWithClusters(selectedClusters)}
          disabled={isCrawling || !hasSelection}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:from-cyan-400 hover:to-blue-500 hover:shadow-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50 ml-auto cursor-pointer"
        >
          <span>🚀</span>
          <span>
            {isCrawling
              ? "Đang cào dữ liệu theo cụm..."
              : `Tiến hành cào mẫu theo cụm đã chọn (${selectedClusters.length} cụm)`}
          </span>
        </button>
      </div>
    </section>
  );
}
