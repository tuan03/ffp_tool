import React, { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
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
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>🕵️</span> Thư viện Quảng cáo Đối thủ (Competitor Spy Intelligence)
            </h3>
            <p className="text-xs text-slate-600">
              Cào và phân tích cấu trúc creative từ Meta Ad Library của các đối thủ cùng niche
            </p>
          </div>
          <div className="text-xs text-slate-600 font-mono">
            Provider: <strong className="text-blue-700">{competitorReport?.provider ?? "Chưa kết nối được nguồn"}</strong>
          </div>
        </div>

        {/* Watchlist Chips & Distribution */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-600 font-medium">Page đối thủ phát hiện:</span>
            {competitorReport?.watchlist && competitorReport.watchlist.length > 0 ? (
              competitorReport.watchlist.map((w) => (
                <span
                  key={w.pageId}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-900 font-semibold"
                >
                  {w.pageName}{" "}
                  <span className="text-blue-700 font-mono text-[11px]">({w.activeAdCount} active)</span>
                </span>
              ))
            ) : (
              <span className="text-slate-500 italic">Chưa phát hiện (Hãy bấm &quot;Spy đối thủ&quot;)</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 text-xs">Tổng số ads:</span>
            <span className="font-mono font-bold text-emerald-700">{competitorReport ? `${competitorReport.activeAds} đang chạy` : "Chưa xác định"}</span>
          </div>
        </div>
      </div>

      {competitorReport?.transparencyDisclaimer && <p className="text-xs text-slate-600">{competitorReport.transparencyDisclaimer}</p>}

      {/* 2. Format Filter Bar */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
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
                  ? "bg-slate-50 text-blue-700 border border-blue-300"
                  : "bg-slate-50 text-slate-600 border border-slate-200 hover:text-slate-900"
              }`}
            >
              {fmt === "ALL" ? "Tất cả định dạng" : fmt}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-600 font-mono">
          Hiển thị {displayedAds.length}/{filteredAds.length} mẫu quảng cáo
        </div>
      </div>

      {!competitorReport && <p role="status" className="rounded-lg border border-amber-200 p-4 text-sm text-amber-700">Chưa tải được nguồn quảng cáo. Kiểm tra kết nối; danh sách nghiên cứu bên dưới vẫn được tải riêng.</p>}
      {competitorReport && filteredAds.length === 0 && (
        <div role="status" className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center space-y-2">
          <p className="text-sm font-medium text-slate-700">
            {ads.length === 0
              ? "Chưa có dữ liệu quảng cáo đối thủ cho store này."
              : "Không có quảng cáo thuộc định dạng đang chọn. Hãy chọn Tất cả định dạng."}
          </p>
          {ads.length === 0 && (
            <p className="text-xs text-slate-600 max-w-lg mx-auto">
              Bấm nút <strong className="text-blue-700">&quot;Spy đối thủ&quot;</strong> ở phía trên để AI tự động cào sản phẩm từ store, quét Facebook Ad Library tìm đối thủ cùng niche và trích xuất creative gaps.
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
              className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden shadow-sm hover:border-slate-300 transition flex flex-col justify-between"
            >
              <div>
                {/* Media Thumbnail Preview */}
                <div className="relative h-44 bg-white flex items-center justify-center overflow-hidden border-b border-slate-200">
                  <CompetitorAdMedia ad={ad} />

                  {/* Badges on Thumbnail */}
                  <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase bg-slate-50 text-blue-700 border border-slate-300">
                      {ad.mediaType}
                    </span>
                    {isLongObservedAd && (
                      <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                        <span>🔥</span>
                        <span>{ad.daysActive} ngày (thời gian theo nguồn)</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Ad Content */}
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900">{ad.pageName}</span>
                    <span className="text-slate-500 font-mono text-[10px]">
                      {ad.daysActive} ngày chạy
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-slate-900 line-clamp-1">
                    {ad.headline || "Quảng cáo hiển thị đối thủ"}
                  </h4>

                  <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
                    {ad.copy || "Không có nội dung văn bản mở rộng."}
                  </p>

                  <div className="flex flex-wrap gap-3 text-xs text-blue-700">
                    {/^\d+$/.test(ad.archiveAdId) && <a href={`https://www.facebook.com/ads/library/?id=${ad.archiveAdId}`} target="_blank" rel="noreferrer" className="underline">Mở quảng cáo gốc</a>}
                    {/^https?:\/\//.test(ad.landingUrl) && <a href={ad.landingUrl} target="_blank" rel="noreferrer" className="underline">Xem sản phẩm</a>}
                  </div>
                  <p className="text-[11px] text-slate-600">Trạng thái tại lúc thu thập: {ad.status === "ACTIVE" ? "Đang hoạt động" : "Đã ngừng hoạt động"}</p>
                  <p className="text-[11px] text-slate-500">Mức kiểm tra: {ad.inspectionLevel === "SAMPLED_FRAMES" ? "Đã xem khung hình mẫu; chưa đánh giá toàn bộ âm thanh" : ad.inspectionLevel === "IMAGE_REVIEWED" ? "Đã xem ảnh" : ad.inspectionLevel}</p>

                  {/* Taxonomy Tags */}
                  <div className="flex flex-wrap gap-1 pt-1">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-white text-blue-700 border border-blue-200">
                      Hook: {ad.taxonomy.hookType}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
                      Angle: {ad.taxonomy.angle}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom CTA */}
              <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">
                  ID: {ad.archiveAdId.slice(0, 10)}...
                </span>
                <button
                  type="button"
                  disabled={!gaps.length}
                  onClick={() => { if (gaps[0]) onCreateBriefFromGap(gaps[0].id); }}
                  className="px-2.5 py-1 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-50 text-xs font-semibold transition cursor-pointer flex items-center gap-1"
                >
                  <span><AppIcon name="seo" /></span>
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
            className="px-5 py-2.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-50 text-blue-700 font-semibold text-xs shadow-md transition cursor-pointer flex items-center gap-2 active:scale-95"
          >
            <span>Hiển thị thêm (+12 mẫu)</span>
            <span className="text-[11px] text-slate-600 font-mono">(Còn {remainingCount} mẫu)</span>
          </button>
        </div>
      )}

      {/* 4. Creative Gaps Analysis */}
      {gaps.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-slate-50 p-5 space-y-4 shadow-sm">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span><AppIcon name="info" /></span> Khoảng trống Creative (Creative Angle Gaps)
            </h3>
            <p className="text-xs text-slate-600">
              Các góc tiếp cận để nghiên cứu và thử nghiệm; chưa biết hiệu quả kinh doanh của đối thủ
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {gaps.map((gap) => (
              <div
                key={gap.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5 flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">{gap.patternName}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      {gap.ownStatus}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">{gap.whyTestNext}</p>
                  <div className="text-[11px] text-blue-700 bg-blue-50 p-2 rounded border border-blue-200">
                    <strong>Ý tưởng kịch bản:</strong> {gap.suggestedBrief.storyboardIdea}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onCreateBriefFromGap(gap.id)}
                    className="px-3 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:text-slate-900 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                  >
                    <span><AppIcon name="seo" /></span>
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
