import type { ComparisonRow } from "../../types";
import type { LightboxImageItem } from "./ImageLightboxModal";

interface ComparisonTableProps {
  readonly rows: readonly ComparisonRow[];
  readonly onPreviewImage?: (item: LightboxImageItem) => void;
}

export function ComparisonTable({ rows, onPreviewImage }: ComparisonTableProps): React.JSX.Element {
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
        Đối chiếu trực quan từng thiết kế qua 4 công đoạn (nhấp vào bất kỳ ảnh nào để soi HD 100%): từ ảnh cào Pinterest gốc, phôi bóc tách nền trắng, file in CMYK 300 DPI, đến phối cảnh mockup phòng AI.
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
              <div
                className="group flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 transition hover:border-slate-700 cursor-pointer"
                onClick={() =>
                  onPreviewImage?.({
                    url: row.source_url,
                    title: `${row.product_label} - Ảnh Pinterest gốc`,
                    subtitle: `Mẫu #${row.index}`,
                    badge: "Pinterest Gốc",
                  })
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    1. Ảnh gốc Pinterest
                  </span>
                  <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition">
                    🔍 Soi
                  </span>
                </div>
                <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-950">
                  <img
                    src={row.source_url}
                    alt="Ảnh gốc Pinterest"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src =
                        "data:image/svg+xml;charset=utf-8," +
                        encodeURIComponent(
                          `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="#0f172a"/><text x="150" y="150" fill="#818cf8" font-family="sans-serif" font-size="12" text-anchor="middle">Ảnh gốc Pinterest</text></svg>`,
                        );
                    }}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </div>
              </div>

              {/* Step 2: Phôi bóc tách */}
              <div
                className="group flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 transition hover:border-slate-700 cursor-pointer"
                onClick={() => {
                  const cutoutUrl = row.cutout_white_url ?? row.cutout_url ?? row.source_url;
                  onPreviewImage?.({
                    url: cutoutUrl,
                    title: `${row.product_label} - Phôi bóc tách nền trắng`,
                    subtitle: `Mẫu #${row.index}`,
                    badge: "Phôi Trắng",
                  });
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    2. Phôi bóc tách (Trắng)
                  </span>
                  <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition">
                    🔍 Soi
                  </span>
                </div>
                <div className="aspect-square w-full overflow-hidden rounded-md bg-white">
                  <img
                    src={row.cutout_white_url ?? row.cutout_url ?? row.source_url}
                    alt="Phôi bóc tách"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src =
                        "data:image/svg+xml;charset=utf-8," +
                        encodeURIComponent(
                          `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="#ffffff"/><text x="150" y="150" fill="#475569" font-family="sans-serif" font-size="12" text-anchor="middle">Phôi bóc tách</text></svg>`,
                        );
                    }}
                    className="h-full w-full object-contain transition group-hover:scale-105"
                  />
                </div>
              </div>

              {/* Step 3: File CMYK 300DPI */}
              <div
                className="group flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 transition hover:border-cyan-600/60 cursor-pointer"
                onClick={() =>
                  onPreviewImage?.({
                    url: row.final_print_url,
                    title: `${row.product_label} - File in CMYK 300 DPI`,
                    subtitle: `Mẫu #${row.index} - Đạt chuẩn sản xuất nhà xưởng`,
                    badge: "CMYK 300 DPI",
                    dpi: 300,
                    colorMode: "CMYK",
                    downloadUrl: row.final_print_url,
                  })
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-cyan-300 uppercase tracking-wider">
                    3. File CMYK 300 DPI
                  </span>
                  <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 transition">
                    🔍 Soi HD
                  </span>
                </div>
                <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-950">
                  <img
                    src={row.final_print_url}
                    alt="File in CMYK 300DPI"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src =
                        "data:image/svg+xml;charset=utf-8," +
                        encodeURIComponent(
                          `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="#0f172a"/><text x="150" y="150" fill="#34d399" font-family="sans-serif" font-size="12" text-anchor="middle">File CMYK 300DPI</text></svg>`,
                        );
                    }}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </div>
              </div>

              {/* Step 4: Mockup Phòng Khách AI */}
              <div
                className="group flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 transition hover:border-indigo-600/60 cursor-pointer"
                onClick={() => {
                  const mockupUrl = row.ai_background_urls[0] ?? row.final_print_url;
                  onPreviewImage?.({
                    url: mockupUrl,
                    title: `${row.product_label} - Mockup Phòng Khách AI`,
                    subtitle: `Mẫu #${row.index} - Bối cảnh kiến trúc nội thất AI`,
                    badge: "Mockup AI",
                    downloadUrl: mockupUrl,
                  });
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-indigo-300 uppercase tracking-wider">
                    4. Mockup Phòng AI
                  </span>
                  <span className="text-[10px] text-indigo-400 opacity-0 group-hover:opacity-100 transition">
                    🔍 Soi HD
                  </span>
                </div>
                <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-950">
                  <img
                    src={row.ai_background_urls[0] ?? row.final_print_url}
                    alt="Mockup phòng khách AI"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src =
                        "data:image/svg+xml;charset=utf-8," +
                        encodeURIComponent(
                          `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="#0f172a"/><text x="150" y="150" fill="#60a5fa" font-family="sans-serif" font-size="12" text-anchor="middle">Mockup AI</text></svg>`,
                        );
                    }}
                    className="h-full w-full object-cover transition group-hover:scale-105"
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
