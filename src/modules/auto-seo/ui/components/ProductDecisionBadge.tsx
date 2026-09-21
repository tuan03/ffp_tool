import type { ProductReviewDecision } from "../../types";

interface ProductDecisionBadgeProps {
  decision?: ProductReviewDecision;
}

export function ProductDecisionBadge({ decision = "pending" }: ProductDecisionBadgeProps): React.JSX.Element {
  switch (decision) {
    case "approved":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/80 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-800/80 shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Đã duyệt
        </span>
      );
    case "needs_edit":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-950/80 px-2.5 py-0.5 text-xs font-semibold text-amber-400 border border-amber-800/80 shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Cần sửa
        </span>
      );
    case "mark_draft":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-purple-950/80 px-2.5 py-0.5 text-xs font-semibold text-purple-400 border border-purple-800/80 shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
          Draft
        </span>
      );
    case "skipped":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-950/80 px-2.5 py-0.5 text-xs font-semibold text-rose-400 border border-rose-800/80 shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
          Bỏ qua
        </span>
      );
    case "pending":
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/80 px-2.5 py-0.5 text-xs font-medium text-slate-400 border border-slate-700">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
          Chờ duyệt
        </span>
      );
  }
}
