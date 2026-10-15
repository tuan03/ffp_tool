import { AppIcon } from "../../../shared/components/AppIcon";
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
    badgeClass: "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 ",
    dotClass: "bg-blue-600",
    hintLabel: "Đã SEO sẵn",
    hintTitle: "Sản phẩm đã hoàn thiện SEO trong pipeline cào, sẵn sàng cập nhật hoặc phê duyệt đồng bộ.",
    hintClass: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    hintIcon: "✓",
  };

  if (origin === "pinterest_pod") {
    badgeConfig = {
      label: "Pinterest POD",
      icon: "🎨",
      badgeClass: "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 ",
      dotClass: "bg-blue-600",
      hintLabel: "Cần duyệt lại",
      hintTitle: "Sản phẩm thiết kế từ Pinterest POD, cần duyệt lại tiêu đề, mô tả và ảnh in trước khi đồng bộ.",
      hintClass: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
      hintIcon: "⏳",
    };
  } else if (origin === "auto_seo") {
    badgeConfig = {
      label: "Auto SEO",
      icon: "🤖",
      badgeClass: "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 ",
      dotClass: "bg-blue-600",
      hintLabel: "Kết quả Auto SEO",
      hintTitle: "Nội dung SEO đã được lưu để xem lại; không yêu cầu duyệt tại trang này.",
      hintClass: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
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
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border select-none ${badgeConfig.hintClass}`}
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
              ? `Đích đã lưu: ${product.storeId}. Bạn đang xem store ${targetStoreId}; việc xem không thay đổi đích sync.`
              : `Gắn với Shopify Store: ${effectiveStore}`
          }
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 select-none"
        >
          <span><AppIcon name="store" /></span>
          <span>{product.storeId || targetStoreId}</span>
          {isDifferentTarget && (
            <span className="text-amber-700 dark:text-amber-300 font-sans text-xs">Khác store đang xem</span>
          )}
        </span>
      )}
    </div>
  );
}
