import type { ComparisonRow } from "../../types";

interface ComparisonTableProps {
  readonly rows: readonly ComparisonRow[];
}

export function ComparisonTable({ rows }: ComparisonTableProps): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-8 text-center text-xs text-slate-400">
        Chưa có dữ liệu so sánh 4 bước cho job này.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs text-slate-400">
        Đối chiếu trực quan từng thiết kế qua 4 công đoạn: từ ảnh cào Pinterest gốc, phôi bóc tách nền trắng, file in CMYK 300 DPI, đến phối cảnh mockup phòng AI.
      </div>

      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <div
            key={row.index}
            className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-4 shadow"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-sm text-cyan-300">{row.product_label}</span>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 font-mono">
                Thành phẩm #{row.index}
              </span>
            </div>

            {/* 4 Steps Row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 items-center">
              {/* Step 1: Ảnh gốc */}
              <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  1. Ảnh gốc Pinterest
                </span>
                <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-950">
                  <img
                    src={row.source_url}
                    alt="Ảnh gốc Pinterest"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>

              {/* Step 2: Phôi bóc tách */}
              <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  2. Phôi bóc tách (Trắng)
                </span>
                <div className="aspect-square w-full overflow-hidden rounded-md bg-white">
                  <img
                    src={row.cutout_white_url ?? row.cutout_url ?? row.source_url}
                    alt="Phôi bóc tách"
                    className="h-full w-full object-contain"
                  />
                </div>
              </div>

              {/* Step 3: File CMYK 300DPI */}
              <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  3. File CMYK 300 DPI
                </span>
                <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-950">
                  <img
                    src={row.final_print_url}
                    alt="File in CMYK 300DPI"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>

              {/* Step 4: Mockup Phòng Khách AI */}
              <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  4. Mockup Phòng AI
                </span>
                <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-950">
                  <img
                    src={row.ai_background_urls[0] ?? row.final_print_url}
                    alt="Mockup phòng khách AI"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
