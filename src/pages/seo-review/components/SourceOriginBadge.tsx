import { getProductSourceOrigin } from "../seo-content-ui-adapter";
import type { SeoProductUiViewModel } from "../types";

export interface SourceOriginBadgeProps {
  readonly product: SeoProductUiViewModel;
  readonly showStatusHint?: boolean;
  readonly showStore?: boolean;
  readonly targetStoreId?: string;
  readonly className?: string;
}

export function SourceOriginBadge({
  product,
  showStatusHint = true,
  showStore = false,
  targetStoreId,
  className = "",
}: SourceOriginBadgeProps): React.JSX.Element {
  const origin = getProductSourceOrigin(product);

  let badgeConfig = {
    label: "Distributed Crawl",
    icon: "⚡",
    badgeClass: "bg-cyan-950/80 text-cyan-300 border-cyan-700/60 shadow-cyan-950/20",
    dotClass: "bg-cyan-400",
    hintLabel: "Đã SEO sẵn",
    hintTitle: "Sản phẩm đã hoàn thiện SEO trong pipeline cào, sẵn sàng cập nhật hoặc phê duyệt đồng bộ.",
    hintClass: "bg-emerald-950/70 text-emerald-300 border-emerald-800/50",
    hintIcon: "✓",
  };

  if (origin === "pinterest_pod") {
    badgeConfig = {
      label: "Pinterest POD",
      icon: "🎨",
      badgeClass: "bg-pink-950/80 text-pink-300 border-pink-700/60 shadow-pink-950/20",
      dotClass: "bg-pink-400",
      hintLabel: "Cần duyệt lại",
      hintTitle: "Sản phẩm thiết kế từ Pinterest POD, cần duyệt lại tiêu đề, mô tả và ảnh in trước khi đồng bộ.",
      hintClass: "bg-amber-950/70 text-amber-300 border-amber-800/50",
      hintIcon: "⏳",
    };
  } else if (origin === "auto_seo") {
    badgeConfig = {
      label: "Auto SEO",
      icon: "🤖",
      badgeClass: "bg-purple-950/80 text-purple-300 border-purple-700/60 shadow-purple-950/20",
      dotClass: "bg-purple-400",
      hintLabel: "Cần duyệt lại",
      hintTitle: "Sản phẩm tuyển chọn từ Auto SEO, cần duyệt lại nội dung SEO trước khi đồng bộ.",
      hintClass: "bg-amber-950/70 text-amber-300 border-amber-800/50",
      hintIcon: "⏳",
    };
  }

  const effectiveStore = product.storeId || targetStoreId;
  const isDifferentTarget = Boolean(
    product.storeId && targetStoreId && product.storeId.toLowerCase() !== targetStoreId.toLowerCase(),
  );

  return (
    <div className={`inline-flex items-center gap-1.5 flex-wrap ${className}`}>
      {/* Origin Module Badge */}
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border shadow-sm select-none ${badgeConfig.badgeClass}`}
      >
        <span>{badgeConfig.icon}</span>
        <span>{badgeConfig.label}</span>
      </span>

      {/* Workflow SEO Status Hint */}
      {showStatusHint && (
        <span
          title={badgeConfig.hintTitle}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border select-none ${badgeConfig.hintClass}`}
        >
          <span>{badgeConfig.hintIcon}</span>
          <span>{badgeConfig.hintLabel}</span>
        </span>
      )}

      {/* Optional Store Indicator */}
      {showStore && effectiveStore && (
        <span
          title={
            isDifferentTarget
              ? `Store gốc: ${product.storeId} → Store đích khi sync: ${targetStoreId}`
              : `Gắn với Shopify Store: ${effectiveStore}`
          }
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700 select-none"
        >
          <span>🏪</span>
          <span>{product.storeId || targetStoreId}</span>
          {isDifferentTarget && (
            <span className="text-amber-400 font-sans text-[10px]">➔ {targetStoreId}</span>
          )}
        </span>
      )}
    </div>
  );
}
