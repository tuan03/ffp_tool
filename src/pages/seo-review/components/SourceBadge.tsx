import type { FieldSource } from "../types";

export interface SourceBadgeProps {
  readonly source: FieldSource;
  readonly className?: string;
}

/**
 * Subtle indicator shown when a field's value is derived from a mock/fallback
 * rather than verified authentic data from the SEO Content module.
 */
export function SourceBadge({ source, className = "" }: SourceBadgeProps): React.JSX.Element | null {
  if (source === "real") {
    return null;
  }

  return (
    <span
      title="Dữ liệu chưa được SEO Content trả về (Đang hiển thị Mock Preview)"
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono tracking-tight bg-amber-500/10 text-amber-400/90 border border-amber-500/20 select-none ${className}`}
    >
      Mock
    </span>
  );
}
