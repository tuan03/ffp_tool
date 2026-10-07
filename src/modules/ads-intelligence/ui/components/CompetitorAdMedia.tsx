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
  const cleanUrl = url.replace(/&amp;/g, "&");
  if (
    cleanUrl.includes("fbcdn.net") ||
    cleanUrl.includes("facebook.com") ||
    cleanUrl.includes("cdninstagram.com") ||
    cleanUrl.includes("instagram.com") ||
    cleanUrl.includes("fbsbx.com")
  ) {
    return `/api/ads-intelligence/media-proxy?url=${encodeURIComponent(cleanUrl)}`;
  }
  return cleanUrl;
}

function isPlayableVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  let targetUrl = url;
  if (url.includes("media-proxy?url=")) {
    try {
      const parsed = new URL(url, "http://localhost");
      targetUrl = parsed.searchParams.get("url") || url;
    } catch {
      targetUrl = url;
    }
  }
  const clean = targetUrl.split("?")[0]?.toLowerCase() ?? "";
  if (/\.(jpe?g|png|webp|gif|svg)$/i.test(clean)) return false;
  if (clean.includes("photo-") || clean.includes("unsplash.com")) return false;
  if (/\.(mp4|webm|mov|m4v)$/i.test(clean)) return true;
  if (targetUrl.includes("video") || targetUrl.includes("fbcdn.net/v/") || targetUrl.includes("t42.")) return true;
  return true;
}

export function CompetitorAdMedia({ ad }: { readonly ad: Pick<CompetitorAd, "mediaType" | "mediaUrls" | "thumbnailUrl" | "cards" | "headline" | "pageName" | "archiveAdId"> }): React.JSX.Element {
  const [hasVideoError, setHasVideoError] = useState(false);
  const [hasImageError, setHasImageError] = useState(false);
  const source = toProxyMediaUrl(ad.mediaUrls[0]);
  const thumbnail = toProxyMediaUrl(ad.thumbnailUrl);
  const label = ad.headline || ad.pageName;

  const canPlayAsVideo = !hasVideoError && ad.mediaType === "VIDEO" && source && isPlayableVideoUrl(source);

  if (canPlayAsVideo) {
    return (
      <video
        key={source}
        aria-label={`Video quảng cáo ${ad.pageName}`}
        controls
        preload="none"
        playsInline
        referrerPolicy="no-referrer"
        poster={thumbnail !== source ? thumbnail : undefined}
        src={source}
        onError={() => setHasVideoError(true)}
        className="h-full w-full object-contain"
      />
    );
  }

  if (hasVideoError && ad.mediaType === "VIDEO") {
    return (
      <div className="relative h-full w-full flex flex-col items-center justify-center bg-slate-900/80 p-4 text-center">
        {thumbnail && (
          <img
            src={thumbnail}
            alt={label}
            className="absolute inset-0 h-full w-full object-contain opacity-30"
          />
        )}
        <div className="relative z-10 flex flex-col items-center gap-2">
          <p className="text-xs text-amber-300">Không tải được video trực tiếp từ nguồn.</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHasVideoError(false)}
              className="rounded bg-slate-800 px-2.5 py-1 text-xs text-cyan-300 border border-cyan-500/30 hover:bg-slate-700 transition cursor-pointer"
            >
              🔄 Thử tải lại
            </button>
            {/^\d+$/.test(ad.archiveAdId) && (
              <a
                href={`https://www.facebook.com/ads/library/?id=${ad.archiveAdId}`}
                target="_blank"
                rel="noreferrer"
                className="rounded bg-blue-600/80 px-2.5 py-1 text-xs text-white hover:bg-blue-600 transition"
              >
                Xem trên Meta Ad Library
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  const cards = ad.cards?.map(card => ({ ...card, mediaUrl: toProxyMediaUrl(card.mediaUrl) })).filter(card => Boolean(card.mediaUrl)) ?? [];
  if (!hasImageError && ad.mediaType === "CAROUSEL" && cards.length > 0) {
    return (
      <div aria-label={`Ảnh carousel ${ad.pageName}`} className="flex h-full w-full snap-x overflow-x-auto">
        {cards.map((card, index) => (
          <img
            key={`${card.mediaUrl}-${index}`}
            src={card.mediaUrl}
            alt={card.headline || `${label} — ${index + 1}`}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setHasImageError(true)}
            className="h-full w-full shrink-0 snap-center object-contain"
          />
        ))}
      </div>
    );
  }

  const imageSource = thumbnail ?? source;
  if (!hasImageError && imageSource) {
    return (
      <div className="relative h-full w-full flex items-center justify-center">
        <img
          src={imageSource}
          alt={label}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setHasImageError(true)}
          className="h-full w-full object-contain"
        />
        {ad.mediaType === "VIDEO" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/25">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-lg backdrop-blur-sm border border-white/20 pl-0.5 text-xs">
              ▶
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4 text-center text-xs text-slate-400">
      <p>{hasVideoError || hasImageError ? "Không tải được media từ nguồn." : "Nguồn chưa cung cấp ảnh/video."}</p>
      {/^\d+$/.test(ad.archiveAdId) && (
        <a href={`https://www.facebook.com/ads/library/?id=${ad.archiveAdId}`} target="_blank" rel="noreferrer" className="text-cyan-300 underline">
          Xem trên Meta Ad Library
        </a>
      )}
    </div>
  );
}
