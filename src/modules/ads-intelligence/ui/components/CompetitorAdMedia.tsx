import type { HTMLAttributeReferrerPolicy } from "react";
import { useState } from "react";

import type { CompetitorAd } from "../../types";

declare module "react" {
  interface VideoHTMLAttributes<T> extends MediaHTMLAttributes<T> {
    referrerPolicy?: HTMLAttributeReferrerPolicy | undefined;
  }
}

function toProxyMediaUrl(url: string | undefined): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  if (url.startsWith("/api/") || url.startsWith("./") || url.startsWith("/")) return url;
  if (
    url.includes("fbcdn.net") ||
    url.includes("facebook.com") ||
    url.includes("cdninstagram.com") ||
    url.includes("instagram.com")
  ) {
    return `/api/ads-intelligence/media-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export function CompetitorAdMedia({ ad }: { readonly ad: Pick<CompetitorAd, "mediaType" | "mediaUrls" | "thumbnailUrl" | "cards" | "headline" | "pageName" | "archiveAdId"> }): React.JSX.Element {
  const [hasMediaError, setHasMediaError] = useState(false);
  const source = toProxyMediaUrl(ad.mediaUrls[0]);
  const thumbnail = toProxyMediaUrl(ad.thumbnailUrl);
  const label = ad.headline || ad.pageName;

  if (!hasMediaError && ad.mediaType === "VIDEO" && source) {
    return (
      <video
        aria-label={`Video quảng cáo ${ad.pageName}`}
        controls
        preload="metadata"
        playsInline
        referrerPolicy="no-referrer"
        poster={thumbnail !== source ? thumbnail : undefined}
        src={source}
        onError={() => setHasMediaError(true)}
        className="h-full w-full object-contain"
      />
    );
  }

  const cards = ad.cards?.map(card => ({ ...card, mediaUrl: toProxyMediaUrl(card.mediaUrl) })).filter(card => Boolean(card.mediaUrl)) ?? [];
  if (!hasMediaError && ad.mediaType === "CAROUSEL" && cards.length > 0) {
    return (
      <div aria-label={`Ảnh carousel ${ad.pageName}`} className="flex h-full w-full snap-x overflow-x-auto">
        {cards.map((card, index) => (
          <img
            key={`${card.mediaUrl}-${index}`}
            src={card.mediaUrl}
            alt={card.headline || `${label} — ${index + 1}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setHasMediaError(true)}
            className="h-full w-full shrink-0 snap-center object-contain"
          />
        ))}
      </div>
    );
  }

  const imageSource = thumbnail ?? (ad.mediaType === "IMAGE" ? source : undefined);
  if (!hasMediaError && imageSource) {
    return (
      <img
        src={imageSource}
        alt={label}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setHasMediaError(true)}
        className="h-full w-full object-contain"
      />
    );
  }

  return (
    <div className="space-y-2 p-4 text-center text-xs text-slate-400">
      <p>{hasMediaError ? "Không tải được media từ nguồn." : "Nguồn chưa cung cấp ảnh/video."}</p>
      {/^\d+$/.test(ad.archiveAdId) && (
        <a href={`https://www.facebook.com/ads/library/?id=${ad.archiveAdId}`} target="_blank" rel="noreferrer" className="text-cyan-300 underline">
          Xem trên Meta Ad Library
        </a>
      )}
    </div>
  );
}
