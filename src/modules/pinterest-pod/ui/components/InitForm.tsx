import type { JobStatus, PinterestProductType, ReferenceImage } from "../../types";
import { ReferenceDropzone } from "./ReferenceDropzone";

const SUGGESTED_CHIPS = [
  "vintage distressed rug",
  "boho runner rug",
  "persian medallion rug",
  "nordic minimalist rug",
  "retro 70s accent blanket",
  "floral cozy blanket",
] as const;

interface InitFormProps {
  readonly niche: string;
  readonly onNicheChange: (niche: string) => void;
  readonly product: PinterestProductType;
  readonly onProductChange: (product: PinterestProductType) => void;
  readonly referenceImages: readonly ReferenceImage[];
  readonly onReferenceImagesChange: (images: readonly ReferenceImage[]) => void;
  readonly jobStatus: JobStatus;
  readonly onStartCrawl: () => void;
  readonly onStopJob: () => void;
}

export function InitForm({
  niche,
  onNicheChange,
  product,
  onProductChange,
  referenceImages,
  onReferenceImagesChange,
  jobStatus,
  onStartCrawl,
  onStopJob,
}: InitFormProps): React.JSX.Element {
  const isBusy = jobStatus === "running" || jobStatus === "producing";

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
          <span>⚙️</span>
          <span>Khởi tạo Job Cào Pinterest POD</span>
        </h2>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Giai đoạn 1
        </span>
      </div>

      {/* Niche Input */}
      <div className="flex flex-col gap-2">
        <label htmlFor="niche-input" className="text-xs font-semibold text-slate-200">
          Từ khóa xu hướng Pinterest <span className="text-rose-400">*</span>
        </label>
        <input
          id="niche-input"
          type="text"
          value={niche}
          onChange={(e) => onNicheChange(e.target.value)}
          placeholder="Ví dụ: vintage distressed rug, boho runner..."
          disabled={isBusy}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50"
        />

        {/* Quick Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] font-medium text-slate-400">Gợi ý nhanh:</span>
          {SUGGESTED_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={isBusy}
              onClick={() => onNicheChange(chip)}
              className="rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[11px] text-slate-300 transition hover:border-cyan-500 hover:bg-slate-700 hover:text-cyan-300 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Product Select */}
      <div className="flex flex-col gap-2">
        <label htmlFor="product-select" className="text-xs font-semibold text-slate-200">
          Loại sản phẩm POD <span className="text-rose-400">*</span>
        </label>
        <select
          id="product-select"
          value={product}
          onChange={(e) => onProductChange(e.target.value as PinterestProductType)}
          disabled={isBusy}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50"
        >
          <option value="rug">Thảm trải sàn (Rug) - Chuẩn 4000x6400px</option>
          <option value="blanket">Chăn ném mềm (Blanket) - Chuẩn 10000x11000px</option>
        </select>
      </div>

      {/* Reference Images Dropzone */}
      <ReferenceDropzone
        images={referenceImages}
        onChange={onReferenceImagesChange}
        disabled={isBusy}
        maxImages={5}
      />

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onStartCrawl}
          disabled={isBusy || !niche.trim()}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:from-cyan-400 hover:to-blue-500 hover:shadow-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>▶</span>
          <span>{isBusy ? "Đang xử lý..." : "Bắt đầu cào ảnh"}</span>
        </button>

        {isBusy && (
          <button
            type="button"
            onClick={onStopJob}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-600/60 bg-rose-950/40 px-4 py-2.5 text-sm font-semibold text-rose-300 shadow transition hover:bg-rose-900/60 hover:text-white"
          >
            <span>⏹</span>
            <span>Dừng Job</span>
          </button>
        )}
      </div>
    </section>
  );
}
