import React from "react";

export interface PayloadSizeIndicatorProps {
  readonly byteSize: number;
  readonly maxBytes?: number;
}

export const MAX_METAFIELD_SIZE_BYTES = 131072; // 128 KB Shopify limit

export function PayloadSizeIndicator({
  byteSize,
  maxBytes = MAX_METAFIELD_SIZE_BYTES,
}: PayloadSizeIndicatorProps): React.JSX.Element {
  const percent = Math.min(100, Math.round((byteSize / maxBytes) * 100));
  const kbSize = (byteSize / 1024).toFixed(1);
  const maxKb = (maxBytes / 1024).toFixed(0);

  // Status tiers
  let status: "safe" | "warning" | "danger" = "safe";
  let statusColor = "text-emerald-400";
  let barGradient = "from-emerald-500 to-teal-400";
  let bgBadge = "bg-emerald-950/80 border-emerald-800 text-emerald-300";
  let statusLabel = "An toàn (Dưới 80 KB)";

  if (byteSize > 112640) { // > 110 KB
    status = "danger";
    statusColor = "text-rose-400";
    barGradient = "from-amber-500 to-rose-500";
    bgBadge = "bg-rose-950/80 border-rose-800 text-rose-300";
    statusLabel = "Nguy hiểm: Sắp vượt trần 128 KB!";
  } else if (byteSize > 81920) { // > 80 KB
    status = "warning";
    statusColor = "text-amber-400";
    barGradient = "from-teal-400 to-amber-500";
    bgBadge = "bg-amber-950/80 border-amber-800 text-amber-300";
    statusLabel = "Cảnh báo: Đã đạt mức khuyến cáo (> 80 KB)";
  }

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Shopify Metafield Payload Size
          </span>
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${bgBadge}`}>
            {statusLabel}
          </span>
        </div>
        <div className="text-xs font-mono font-medium">
          <span className={statusColor}>{kbSize} KB</span>
          <span className="text-slate-500"> / {maxKb} KB ({percent}%)</span>
        </div>
      </div>

      {/* Progress Track */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barGradient} transition-all duration-300 ease-out`}
          style={{ width: `${percent}%` }}
        />
        {/* Warning threshold markers at 62.5% (80KB) and 86% (110KB) */}
        <div className="absolute top-0 bottom-0 left-[62.5%] w-0.5 bg-amber-400/40" title="Khuyến cáo (80 KB)" />
        <div className="absolute top-0 bottom-0 left-[86%] w-0.5 bg-rose-400/40" title="Giới hạn tối đa (110 KB)" />
      </div>

      <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
        Shopify giới hạn dung lượng lưu trữ Metafield tối đa là 128 KB. Module sẽ tự động nén và loại bỏ asset thừa nếu dữ liệu vượt ngưỡng khuyến nghị.
      </p>
    </div>
  );
}
