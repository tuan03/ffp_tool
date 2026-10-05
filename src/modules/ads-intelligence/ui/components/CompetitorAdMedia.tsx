import { useState } from "react";

import type { CompetitorAd } from "../../types";

function publicUrl(value: string | undefined): string | undefined {
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}

export function CompetitorAdMedia({ ad }: { readonly ad: Pick<CompetitorAd, "mediaType" | "mediaUrls" | "thumbnailUrl" | "cards" | "headline" | "pageName" | "archiveAdId"> }): React.JSX.Element {
  const [hasMediaError, setHasMediaError] = useState(false);
  const source = publicUrl(ad.mediaUrls[0]);
  const thumbnail = publicUrl(ad.thumbnailUrl);
  const label = ad.headline || ad.pageName;
  if (!hasMediaError && ad.mediaType === "VIDEO" && source) {
    return <video aria-label={`Video quảng cáo ${ad.pageName}`} controls preload="none" poster={thumbnail !== source ? thumbnail : undefined} src={source} onError={() => setHasMediaError(true)} className="h-full w-full object-contain" />;
  }
  const cards = ad.cards?.filter(card => publicUrl(card.mediaUrl)) ?? [];
  if (!hasMediaError && ad.mediaType === "CAROUSEL" && cards.length > 0) {
    return <div aria-label={`Ảnh carousel ${ad.pageName}`} className="flex h-full w-full snap-x overflow-x-auto">{cards.map((card, index) => <img key={`${card.mediaUrl}-${index}`} src={card.mediaUrl} alt={card.headline || `${label} — ${index + 1}`} loading="lazy" onError={() => setHasMediaError(true)} className="h-full w-full shrink-0 snap-center object-contain" />)}</div>;
  }
  const imageSource = thumbnail ?? (ad.mediaType === "IMAGE" ? source : undefined);
  if (!hasMediaError && imageSource) return <img src={imageSource} alt={label} loading="lazy" onError={() => setHasMediaError(true)} className="h-full w-full object-contain" />;
  return <div className="space-y-2 p-4 text-center text-xs text-slate-400"><p>{hasMediaError ? "Không tải được media từ nguồn." : "Nguồn chưa cung cấp ảnh/video."}</p>{/^\d+$/.test(ad.archiveAdId) && <a href={`https://www.facebook.com/ads/library/?id=${ad.archiveAdId}`} target="_blank" rel="noreferrer" className="text-cyan-300 underline">Xem trên Meta Ad Library</a>}</div>;
}
