import { inferProductTypeFromNiche } from "../../types";
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

export interface InitFormProps {
  readonly niche: string;
  readonly onNicheChange: (niche: string) => void;
  readonly crawlCount?: number;
  readonly onCrawlCountChange?: (count: number) => void;
  readonly referenceImages: readonly ReferenceImage[];
  readonly onReferenceImagesChange: (images: readonly ReferenceImage[]) => void;
  readonly jobStatus: JobStatus;
  readonly onStartCrawl: () => void;
  readonly onStopJob: () => void;
  /** Optional for backward compatibility with existing callers */
  readonly product?: PinterestProductType;
  readonly onProductChange?: (product: PinterestProductType) => void;
  readonly aiBackgroundVariants?: number;
  readonly onAiBackgroundVariantsChange?: (count: number) => void;
}

export function InitForm({
  niche,
  onNicheChange,
  crawlCount = 40,
  onCrawlCountChange,
  referenceImages,
  onReferenceImagesChange,
  jobStatus,
  onStartCrawl,
  onStopJob,
  product,
  onProductChange,
}: InitFormProps): React.JSX.Element {
  const isBusy = jobStatus === "running" || jobStatus === "producing";
  const detectedProduct = niche.trim() ? inferProductTypeFromNiche(niche) : (product ?? "rug");
  const expectedMockupCount = referenceImages.length > 0 ? referenceImages.length : 5;

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

      {/* Niche Input & Auto-detect Badge */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="niche-input" className="text-xs font-semibold text-slate-200">
            Từ khóa xu hướng Pinterest <span className="text-rose-400">*</span>
          </label>
          <div className="flex items-center gap-1.5 rounded-full bg-slate-800/90 px-2.5 py-0.5 text-[10px] font-medium text-slate-300 border border-slate-700">
            <span className="text-slate-400">Tự động nhận diện:</span>
            <span className="font-bold text-cyan-300">
              {detectedProduct === "blanket"
                ? "Chăn (Blanket - 10000x11000px)"
                : detectedProduct === "custom"
                ? "Tùy biến (Custom - 4000x6400px)"
                : "Thảm (Rug - 4000x6400px)"}
            </span>
          </div>
        </div>
        <input
          id="niche-input"
          type="text"
          value={niche}
          onChange={(e) => {
            const next = e.target.value;
            onNicheChange(next);
            onProductChange?.(inferProductTypeFromNiche(next));
          }}
          placeholder="Ví dụ: vintage distressed rug, boho blanket, persian mat..."
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
              onClick={() => {
                onNicheChange(chip);
                onProductChange?.(inferProductTypeFromNiche(chip));
              }}
              className="rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[11px] text-slate-300 transition hover:border-cyan-500 hover:bg-slate-700 hover:text-cyan-300 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Pinterest Crawl Count Slider (Requirement 2) */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between">
          <label htmlFor="crawl-count-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <span>📥 Số lượng ảnh cào từ Pinterest:</span>
            <span className="text-cyan-400 font-bold">{crawlCount} ảnh</span>
          </label>
          <span className="text-[11px] text-slate-400">10 – 80 ảnh (Mặc định 40)</span>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <input
            id="crawl-count-input"
            type="range"
            min={10}
            max={80}
            step={5}
            value={crawlCount}
            onChange={(e) => onCrawlCountChange?.(Number(e.target.value))}
            disabled={isBusy}
            className="flex-1 accent-cyan-400 h-2 bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50"
          />
          <span className="w-10 text-center text-xs font-bold text-cyan-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
            {crawlCount}
          </span>
        </div>
        <p className="text-[11px] text-slate-400">
          Vision AI sẽ thu thập {crawlCount} ảnh Pinterest, sau đó lọc trùng lặp và chấm điểm nét tự động để đề xuất danh sách ứng viên in ấn tốt nhất.
        </p>
      </div>

      {/* Reference Images Dropzone & Mockup Output Notice (Requirement 4) */}
      <div className="flex flex-col gap-2">
        <ReferenceDropzone
          images={referenceImages}
          onChange={onReferenceImagesChange}
          disabled={isBusy}
          maxImages={10}
        />
        <p className="text-[11px] text-slate-400 px-1">
          {referenceImages.length > 0
            ? `✓ Đã nạp ${referenceImages.length} ảnh phòng tham chiếu: Hệ thống sẽ render chính xác ${referenceImages.length} mockup AI tương ứng.`
            : `Chưa nạp ảnh phòng tham chiếu: Hệ thống sẽ tự động tạo ${expectedMockupCount} mockup lifestyle với bối cảnh cao cấp ngẫu nhiên.`}
        </p>
      </div>

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
