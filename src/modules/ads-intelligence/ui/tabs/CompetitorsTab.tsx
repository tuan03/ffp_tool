import React, { useState } from "react";
import { SpyRunPanel } from "../components/SpyRunPanel";
import { CompetitorAdMedia } from "../components/CompetitorAdMedia";
import { CompetitorResearchPanel } from "../components/CompetitorResearchPanel";
import type { AdsIntelligenceClient, CompetitorIntelligenceReport } from "../../types";

export interface CompetitorsTabProps {
  readonly storeId: string;
  readonly client: AdsIntelligenceClient;
  readonly competitorReport: CompetitorIntelligenceReport | null;
  readonly onCreateBriefFromGap: (gapId: string) => void;
}

export function CompetitorsTab({
  storeId,
  client,
  competitorReport,
  onCreateBriefFromGap,
}: CompetitorsTabProps): React.JSX.Element {
  const [formatFilter, setFormatFilter] = useState<string>("ALL");
  const [visibleCount, setVisibleCount] = useState<number>(12);

  const ads = competitorReport?.ads ?? [];
  const filteredAds = ads.filter((ad) => {
    if (formatFilter === "ALL") return true;
    return ad.mediaType === formatFilter;
  });

  const displayedAds = filteredAds.slice(0, visibleCount);
  const remainingCount = filteredAds.length - displayedAds.length;

  const gaps = competitorReport?.creativeGaps || [];

  return (
    <div className="space-y-6">
      <SpyRunPanel key={storeId} client={client} storeId={storeId} />
      {/* 1. Header & Summary Stats */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 space-y-4 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>🕵️</span> Thư viện Quảng cáo Đối thủ (Competitor Spy Intelligence)
            </h3>
            <p className="text-xs text-slate-400">
              Cào và phân tích cấu trúc creative từ Meta Ad Library của các đối thủ cùng niche
            </p>
          </div>
          <div className="text-xs text-slate-400 font-mono">
            Provider: <strong className="text-cyan-300">{competitorReport?.provider ?? "Chưa kết nối được nguồn"}</strong>
          </div>
        </div>

        {/* Watchlist Chips & Distribution */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400 font-medium">Page đối thủ phát hiện:</span>
            {competitorReport?.watchlist && competitorReport.watchlist.length > 0 ? (
              competitorReport.watchlist.map((w) => (
                <span
                  key={w.pageId}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-semibold"
                >
                  {w.pageName}{" "}
                  <span className="text-cyan-400 font-mono text-[11px]">({w.activeAdCount} active)</span>
                </span>
              ))
            ) : (
              <span className="text-slate-500 italic">Chưa phát hiện (Hãy bấm &quot;Spy đối thủ&quot;)</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 text-xs">Tổng số ads:</span>
            <span className="font-mono font-bold text-emerald-400">{competitorReport ? `${competitorReport.activeAds} đang chạy` : "Chưa xác định"}</span>
          </div>
        </div>
      </div>

      {competitorReport?.transparencyDisclaimer && <p className="text-xs text-slate-400">{competitorReport.transparencyDisclaimer}</p>}

      {/* 2. Format Filter Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          {["ALL", "VIDEO", "IMAGE", "CAROUSEL"].map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => {
                setFormatFilter(fmt);
                setVisibleCount(12);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                formatFilter === fmt
                  ? "bg-slate-800 text-cyan-300 border border-cyan-500/50"
                  : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200"
              }`}
            >
              {fmt === "ALL" ? "Tất cả định dạng" : fmt}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-400 font-mono">
          Hiển thị {displayedAds.length}/{filteredAds.length} mẫu quảng cáo
        </div>
      </div>

      {!competitorReport && <p role="status" className="rounded-lg border border-amber-900 p-4 text-sm text-amber-200">Chưa tải được nguồn quảng cáo. Kiểm tra kết nối; danh sách nghiên cứu bên dưới vẫn được tải riêng.</p>}
      {competitorReport && filteredAds.length === 0 && (
        <div role="status" className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center space-y-2">
          <p className="text-sm font-medium text-slate-300">
            {ads.length === 0
              ? "Chưa có dữ liệu quảng cáo đối thủ cho store này."
              : "Không có quảng cáo thuộc định dạng đang chọn. Hãy chọn Tất cả định dạng."}
          </p>
          {ads.length === 0 && (
            <p className="text-xs text-slate-400 max-w-lg mx-auto">
              Bấm nút <strong className="text-cyan-400">&quot;Spy đối thủ&quot;</strong> ở phía trên để AI tự động cào sản phẩm từ store, quét Facebook Ad Library tìm đối thủ cùng niche và trích xuất creative gaps.
            </p>
          )}
        </div>
      )}

      {/* 3. Visual Ad Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedAds.map((ad) => {
          const isLongObservedAd = ad.daysActive >= 30;

          return (
            <div
              key={ad.archiveAdId}
              className="rounded-xl border border-slate-800 bg-slate-900/70 overflow-hidden shadow-sm hover:border-slate-700 transition flex flex-col justify-between"
            >
              <div>
                {/* Media Thumbnail Preview */}
                <div className="relative h-44 bg-slate-950 flex items-center justify-center overflow-hidden border-b border-slate-800">
                  <CompetitorAdMedia ad={ad} />

                  {/* Badges on Thumbnail */}
                  <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase bg-slate-950/80 text-cyan-300 border border-slate-700">
                      {ad.mediaType}
                    </span>
                    {isLongObservedAd && (
                      <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-950/90 text-amber-300 border border-amber-800 flex items-center gap-1">
                        <span>🔥</span>
                        <span>{ad.daysActive} ngày (thời gian theo nguồn)</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Ad Content */}
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200">{ad.pageName}</span>
                    <span className="text-slate-500 font-mono text-[10px]">
                      {ad.daysActive} ngày chạy
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-slate-100 line-clamp-1">
                    {ad.headline || "Quảng cáo hiển thị đối thủ"}
                  </h4>

                  <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                    {ad.copy || "Không có nội dung văn bản mở rộng."}
                  </p>

                  <div className="flex flex-wrap gap-3 text-xs text-cyan-300">
                    {/^\d+$/.test(ad.archiveAdId) && <a href={`https://www.facebook.com/ads/library/?id=${ad.archiveAdId}`} target="_blank" rel="noreferrer" className="underline">Mở quảng cáo gốc</a>}
                    {/^https?:\/\//.test(ad.landingUrl) && <a href={ad.landingUrl} target="_blank" rel="noreferrer" className="underline">Xem sản phẩm</a>}
                  </div>
                  <p className="text-[11px] text-slate-400">Trạng thái tại lúc thu thập: {ad.status === "ACTIVE" ? "Đang hoạt động" : "Đã ngừng hoạt động"}</p>
                  <p className="text-[11px] text-slate-500">Mức kiểm tra: {ad.inspectionLevel === "SAMPLED_FRAMES" ? "Đã xem khung hình mẫu; chưa đánh giá toàn bộ âm thanh" : ad.inspectionLevel === "IMAGE_REVIEWED" ? "Đã xem ảnh" : ad.inspectionLevel}</p>

                  {/* Taxonomy Tags */}
                  <div className="flex flex-wrap gap-1 pt-1">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-950 text-indigo-300 border border-indigo-900/50">
                      Hook: {ad.taxonomy.hookType}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                      Angle: {ad.taxonomy.angle}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom CTA */}
              <div className="p-3 bg-slate-950/50 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">
                  ID: {ad.archiveAdId.slice(0, 10)}...
                </span>
                <button
                  type="button"
                  disabled={!gaps.length}
                  onClick={() => { if (gaps[0]) onCreateBriefFromGap(gaps[0].id); }}
                  className="px-2.5 py-1 rounded-lg border border-purple-600/60 bg-purple-950/50 text-purple-200 hover:bg-purple-900/60 text-xs font-semibold transition cursor-pointer flex items-center gap-1"
                >
                  <span>✨</span>
                  <span>Tạo Brief từ mẫu này</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {remainingCount > 0 && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => prev + 12)}
            className="px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-cyan-300 font-semibold text-xs shadow-md transition cursor-pointer flex items-center gap-2 active:scale-95"
          >
            <span>Hiển thị thêm (+12 mẫu)</span>
            <span className="text-[11px] text-slate-400 font-mono">(Còn {remainingCount} mẫu)</span>
          </button>
        </div>
      )}

      {/* 4. Creative Gaps Analysis */}
      {gaps.length > 0 && (
        <div className="rounded-2xl border border-indigo-900/50 bg-slate-900/70 p-5 space-y-4 shadow-lg">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>💡</span> Khoảng trống Creative (Creative Angle Gaps)
            </h3>
            <p className="text-xs text-slate-400">
              Các góc tiếp cận để nghiên cứu và thử nghiệm; chưa biết hiệu quả kinh doanh của đối thủ
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {gaps.map((gap) => (
              <div
                key={gap.id}
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5 flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">{gap.patternName}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800">
                      {gap.ownStatus}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{gap.whyTestNext}</p>
                  <div className="text-[11px] text-indigo-300 bg-indigo-950/30 p-2 rounded border border-indigo-900/40">
                    <strong>Ý tưởng kịch bản:</strong> {gap.suggestedBrief.storyboardIdea}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onCreateBriefFromGap(gap.id)}
                    className="px-3 py-1.5 rounded-lg border border-cyan-500/60 bg-gradient-to-r from-cyan-950 to-blue-950 text-cyan-200 hover:text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                  >
                    <span>✨</span>
                    <span>Tạo Brief thử nghiệm ngay</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <CompetitorResearchPanel storeId={storeId} client={client} />
    </div>
  );
}
