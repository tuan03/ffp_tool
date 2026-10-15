import { useState } from "react";

import { AppIcon } from "../../../shared/components/AppIcon";
import { SourceBadge } from "./SourceBadge";
import type { DisplayField } from "../types";

export interface SeoSerpPreviewProps {
  readonly seoTitle: DisplayField<string>;
  readonly seoDescription: DisplayField<string>;
  readonly handle: DisplayField<string>;
  readonly storeDomain?: string;
  readonly compact?: boolean;
}

export function SeoSerpPreview({
  seoTitle,
  seoDescription,
  handle,
  storeDomain = "store.myshopify.com",
  compact = false,
}: SeoSerpPreviewProps): React.JSX.Element {
  const [copiedField, setCopiedField] = useState<"title" | "desc" | null>(null);

  const titleLen = seoTitle.value.length;
  const descLen = seoDescription.value.length;

  function handleCopy(text: string, field: "title" | "desc") {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1600);
    }
  }

  function getTitleStatusBadge(len: number) {
    if (len === 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-rose-50 text-rose-700 border border-rose-200">
          0 / 70 • Thiếu tiêu đề
        </span>
      );
    }
    if (len > 70) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-rose-50 text-rose-700 border border-rose-200">
          {len} / 70 • Quá dài ({len - 70} ký tự)
        </span>
      );
    }
    if (len >= 45 && len <= 65) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          ✓ {len} / 70 • Chuẩn SEO
        </span>
      );
    }
    if (len < 45) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <AppIcon name="warning" /> {len} / 70 • Hơi ngắn
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <AppIcon name="warning" /> {len} / 70 • Giới hạn
      </span>
    );
  }

  function getDescStatusBadge(len: number) {
    if (len === 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-rose-50 text-rose-700 border border-rose-200">
          0 / 160 • Thiếu mô tả
        </span>
      );
    }
    if (len > 160) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-rose-50 text-rose-700 border border-rose-200">
          {len} / 160 • Quá dài ({len - 160} ký tự)
        </span>
      );
    }
    if (len >= 110 && len <= 160) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          ✓ {len} / 160 • Chuẩn SEO
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <AppIcon name="warning" /> {len} / 160 • Hơi ngắn
      </span>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 shadow-sm space-y-2.5">
      {/* Header with SERP indicator & Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="text-blue-700 font-bold"><AppIcon name="search" /> Google Snippet</span>
          <span className="text-slate-500">•</span>
          <span className="text-xs font-mono text-slate-600 truncate max-w-xs">
            https://{storeDomain}/products/{handle.value}
          </span>
          <SourceBadge source={handle.source} />
        </div>

        <div className="flex items-center gap-1.5">
          {getTitleStatusBadge(titleLen)}
          {getDescStatusBadge(descLen)}
        </div>
      </div>

      {/* SEO Title */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
              SEO Title
            </span>
            <SourceBadge source={seoTitle.source} />
          </div>
          <button
            type="button"
            onClick={() => handleCopy(seoTitle.value, "title")}
            className="text-xs font-medium text-slate-600 hover:text-blue-700 transition cursor-pointer px-1.5 py-0.5 rounded hover:bg-slate-50"
            title="Sao chép tiêu đề SEO"
          >
            {copiedField === "title" ? "✓ Đã chép" : "Copy"}
          </button>
        </div>

        <div
          className={`font-semibold text-blue-700 hover:text-blue-700 transition ${
            compact ? "text-sm line-clamp-1" : "text-base leading-snug"
          }`}
        >
          {seoTitle.value || <span className="text-rose-700 italic">Chưa có tiêu đề SEO</span>}
        </div>
      </div>

      {/* SEO Meta Description */}
      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Meta Description
            </span>
            <SourceBadge source={seoDescription.source} />
          </div>
          <button
            type="button"
            onClick={() => handleCopy(seoDescription.value, "desc")}
            className="text-xs font-medium text-slate-600 hover:text-blue-700 transition cursor-pointer px-1.5 py-0.5 rounded hover:bg-slate-50"
            title="Sao chép mô tả SEO"
          >
            {copiedField === "desc" ? "✓ Đã chép" : "Copy"}
          </button>
        </div>

        <div
          className={`text-slate-700 leading-relaxed ${
            compact ? "text-xs line-clamp-2" : "text-xs"
          }`}
        >
          {seoDescription.value || (
            <span className="text-rose-700 italic">Chưa có mô tả SEO</span>
          )}
        </div>
      </div>
    </div>
  );
}
