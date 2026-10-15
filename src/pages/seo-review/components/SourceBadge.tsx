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
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono tracking-tight bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 select-none ${className}`}
    >
      Mock
    </span>
  );
}
