import type { JobStatus, PinterestProductType, ReferenceImage } from "../../types";
import { ReferenceDropzone } from "./ReferenceDropzone";

interface ProductOption {
  readonly type: PinterestProductType;
  readonly label: string;
  readonly icon: string;
  readonly desc: string;
  readonly standard: string;
}

const PRODUCT_OPTIONS: readonly ProductOption[] = [
  {
    type: "bag",
    label: "Túi / Tote (Bag)",
    icon: "🎒",
    desc: "Túi tote, túi xách, ba lô",
    standard: "4500 x 5400 px @ 300 DPI",
  },
  {
    type: "rug",
    label: "Thảm (Rug)",
    icon: "🛋️",
    desc: "Thảm sàn, thảm trang trí",
    standard: "4000 x 6400 px @ 300 DPI",
  },
  {
    type: "blanket",
    label: "Chăn (Blanket)",
    icon: "🛏️",
    desc: "Chăn nỉ sofa, throw blanket",
    standard: "10000 x 11000 px @ 300 DPI",
  },
  {
    type: "custom",
    label: "Tùy biến (Custom)",
    icon: "📐",
    desc: "Phôi tổng hợp hoặc tùy chỉnh",
    standard: "4000 x 6400 px @ 300 DPI",
  },
];

const SUGGESTED_CHIPS = [
  "Halloween spooky cute",
  "Cottagecore botanical",
  "Gothic celestial tarot",
  "Retro groovy 70s",
  "Vintage floral tapestry",
  "Witchy black cat",
  "Whimsical forest mushroom",
  "Boho geometric abstract",
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
  product = "bag",
  onProductChange,
}: InitFormProps): React.JSX.Element {
  const isBusy = jobStatus === "running" || jobStatus === "producing";
  const selectedProduct = product ?? "bag";
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

      {/* 1. Target Product Blank Selection (Decoupled from Niche) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <span>🎯 1. Phôi sản phẩm POD đích:</span>
            <span className="text-cyan-400 font-bold uppercase">{selectedProduct}</span>
          </label>
          <span className="text-[11px] text-slate-400">Chọn loại sản phẩm bạn muốn sản xuất</span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRODUCT_OPTIONS.map((opt) => {
            const isSelected = selectedProduct === opt.type;
            return (
              <button
                key={opt.type}
                type="button"
                disabled={isBusy}
                onClick={() => onProductChange?.(opt.type)}
                className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition ${
                  isSelected
                    ? "border-cyan-500 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-500/50 shadow-md"
                    : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:bg-slate-900/80 hover:text-slate-200"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-base">{opt.icon}</span>
                  {isSelected && (
                    <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.2 text-[9px] font-bold text-cyan-300">
                      ✓ Đã chọn
                    </span>
                  )}
                </div>
                <strong className={`text-xs font-bold ${isSelected ? "text-cyan-200" : "text-slate-200"}`}>
                  {opt.label}
                </strong>
                <span className="text-[10px] text-slate-400 line-clamp-1">{opt.desc}</span>
                <span className="text-[9px] font-medium text-slate-500">{opt.standard}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Visual Trend Motif & Design Keywords */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="niche-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <span>🎨 2. Chủ đề / Họa tiết xu hướng (Visual Motif)</span>
            <span className="text-rose-400">*</span>
          </label>
        </div>

        <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/20 px-3 py-1.5 text-[11px] text-cyan-300">
          💡 <strong>Mẹo POD:</strong> Bạn chỉ cần nhập phong cách, chủ đề nghệ thuật (VD: <em>Halloween, Gothic, Cottagecore...</em>) mà không cần nhập chữ <em>bag</em> hay <em>rug</em>. Pinterest sẽ cào các hoa văn nghệ thuật 2D đẹp nhất, sau đó AI sẽ tự động ốp lên phôi <strong>{selectedProduct.toUpperCase()}</strong> của bạn!
        </div>

        <input
          id="niche-input"
          type="text"
          value={niche}
          onChange={(e) => onNicheChange(e.target.value)}
          placeholder="Ví dụ: Halloween spooky cute, Gothic celestial, Cottagecore botanical, Retro 70s..."
          disabled={isBusy}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50"
        />

        {/* Quick Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] font-medium text-slate-400">Gợi ý xu hướng:</span>
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

      {/* 3. Pinterest Crawl Count Slider */}
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
          Vision AI sẽ thu thập {crawlCount} ảnh Pinterest theo chủ đề &quot;{niche || "xu hướng"}&quot;, sau đó lọc trùng lặp và chấm điểm nét tự động để đề xuất danh sách ứng viên in ấn tốt nhất.
        </p>
      </div>

      {/* 4. Reference Images Dropzone & Mockup Output Notice */}
      <div className="flex flex-col gap-2">
        <ReferenceDropzone
          images={referenceImages}
          onChange={onReferenceImagesChange}
          disabled={isBusy}
          maxImages={10}
        />
        <p className="text-[11px] text-slate-400 px-1">
          {referenceImages.length > 0
            ? `✓ Đã nạp ${referenceImages.length} ảnh phòng/bối cảnh tham chiếu: Hệ thống sẽ render chính xác ${referenceImages.length} mockup AI tương ứng.`
            : `Chưa nạp ảnh bối cảnh tham chiếu: Hệ thống sẽ tự động tạo ${expectedMockupCount} mockup lifestyle với bối cảnh cao cấp ngẫu nhiên.`}
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
          <span>{isBusy ? "Đang xử lý..." : `Bắt đầu cào ảnh cho ${selectedProduct.toUpperCase()}`}</span>
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
