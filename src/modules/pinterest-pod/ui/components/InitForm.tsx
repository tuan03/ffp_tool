import { useState } from "react";
import type { JobStatus, PinterestProductType, ReferenceImage } from "../../types";
import { inferProductTypeFromNiche } from "../../types";
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
    icon: "👜",
    desc: "Túi tote, túi xách, ba lô, clutch",
    standard: "4500 x 5400 px @ 300 DPI",
  },
  {
    type: "rug",
    label: "Thảm (Rug)",
    icon: "🛋️",
    desc: "Thảm sàn, thảm trang trí, thảm cửa",
    standard: "4000 x 6400 px @ 300 DPI",
  },
  {
    type: "blanket",
    label: "Chăn (Blanket)",
    icon: "🛏️",
    desc: "Chăn nỉ sofa, throw blanket, quilt",
    standard: "10000 x 11000 px @ 300 DPI",
  },
  {
    type: "custom",
    label: "Tùy biến (Custom)",
    icon: "📐",
    desc: "Phôi tổng hợp hoặc tùy chỉnh theo yêu cầu",
    standard: "4000 x 6400 px @ 300 DPI",
  },
];

const SUGGESTED_CHIPS = [
  "Leather bag vintage",
  "Halloween spooky cute",
  "Vintage distressed rug",
  "Cottagecore floral blanket",
  "Gothic celestial tarot",
  "Retro groovy 70s",
  "Boho geometric abstract",
  "Dark academia aesthetic",
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
  /** Optional product override or selection */
  readonly product?: PinterestProductType;
  readonly onProductChange?: (product: PinterestProductType) => void;
  readonly aiBackgroundVariants?: number;
  readonly onAiBackgroundVariantsChange?: (count: number) => void;
  /** Advanced Pinterest API settings */
  readonly trendType?: "growing" | "monthly" | "seasonal" | "ALL";
  readonly onTrendTypeChange?: (trendType: "growing" | "monthly" | "seasonal" | "ALL") => void;
  readonly interest?: string;
  readonly onInterestChange?: (interest: string) => void;
  readonly region?: string;
  readonly onRegionChange?: (region: string) => void;
  /** Trend discovery trigger */
  readonly onDiscoverTrends?: () => void;
  readonly isDiscoveringTrends?: boolean;
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
  trendType = "growing",
  onTrendTypeChange,
  interest = "",
  onInterestChange,
  region = "US",
  onRegionChange,
  onDiscoverTrends,
  isDiscoveringTrends = false,
}: InitFormProps): React.JSX.Element {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [overrideProduct, setOverrideProduct] = useState(false);

  const isMatrixMode = trendType === "ALL" && region.toUpperCase() === "ALL";

  const handleToggleMatrixMode = (): void => {
    if (isMatrixMode) {
      onTrendTypeChange?.("growing");
      onRegionChange?.("US");
    } else {
      onTrendTypeChange?.("ALL");
      onRegionChange?.("ALL");
    }
  };

  const isBusy = jobStatus === "running" || jobStatus === "producing" || isDiscoveringTrends;
  const inferredProduct = niche.trim() ? inferProductTypeFromNiche(niche) : "bag";
  const activeProduct = overrideProduct && product ? product : inferredProduct;

  const currentProductOption = PRODUCT_OPTIONS.find((p) => p.type === activeProduct) ?? PRODUCT_OPTIONS[0];

  const handleSelectProduct = (newProduct: PinterestProductType): void => {
    setOverrideProduct(true);
    onProductChange?.(newProduct);
  };

  const handleResetToAutoInferred = (): void => {
    setOverrideProduct(false);
    onProductChange?.(inferredProduct);
  };

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">✨</span>
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              Khởi tạo Khám phá & Sản xuất Pinterest POD
            </h2>
            <p className="text-xs text-slate-400">
              Nhập từ khóa niche để khám phá cụm xu hướng AI và tự động tạo file in CMYK 300 DPI
            </p>
          </div>
        </div>
        <span className="rounded bg-cyan-950/80 border border-cyan-800/60 px-2.5 py-1 text-[11px] font-bold text-cyan-300">
          Tier 1 & 2 Discovery
        </span>
      </div>

      {/* 1. Primary Niche Input */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="niche-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <span>🎯 1. Từ khóa Pinterest Niche / Chủ đề xu hướng:</span>
            <span className="text-rose-400">*</span>
          </label>
          <span className="text-[11px] text-slate-400">Nhập bất kỳ sản phẩm hoặc phong cách nghệ thuật</span>
        </div>

        <div className="relative">
          <input
            id="niche-input"
            type="text"
            value={niche}
            onChange={(e) => onNicheChange(e.target.value)}
            placeholder="Ví dụ: leather bag, halloween, vintage distressed rug, cozy blanket, gothic celestial..."
            disabled={isBusy}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-3.5 pr-28 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50 font-medium"
          />
          {niche.trim() && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-lg bg-slate-800/90 border border-slate-700 px-2 py-1 text-[11px] text-cyan-300 font-semibold shadow">
              <span>{currentProductOption.icon}</span>
              <span>{currentProductOption.label.split(" ")[0]}</span>
            </div>
          )}
        </div>

        {/* Auto Inferred Product Type Badge Notice */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-900/40 bg-cyan-950/20 px-3.5 py-2 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <span className="text-base">{currentProductOption.icon}</span>
            <span>
              Phôi sản phẩm đích: <strong className="text-cyan-300">{currentProductOption.label}</strong>
              <span className="text-slate-400 ml-1.5 font-normal">({currentProductOption.standard})</span>
            </span>
          </div>
          {overrideProduct ? (
            <button
              type="button"
              onClick={handleResetToAutoInferred}
              className="text-[11px] text-amber-300 hover:text-amber-200 underline font-medium"
            >
              (Đang chọn thủ công - Bấm để tự động theo từ khóa)
            </button>
          ) : (
            <span className="text-[11px] text-emerald-400 font-medium">
              ✓ Tự động nhận diện theo từ khóa
            </span>
          )}
        </div>

        {/* Quick Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] font-medium text-slate-400">Gợi ý xu hướng hot:</span>
          {SUGGESTED_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={isBusy}
              onClick={() => onNicheChange(chip)}
              className="rounded-full border border-slate-800 bg-slate-800/60 px-2.5 py-0.5 text-[11px] text-slate-300 transition hover:border-cyan-500 hover:bg-slate-700 hover:text-cyan-300 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Số lượng ảnh cào từ Pinterest (Crawl Pool Size) */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <label htmlFor="crawl-count-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <span>📥 2. Số lượng ảnh cào về từ Pinterest:</span>
            <span className="text-cyan-400 font-bold text-sm">{crawlCount} ảnh</span>
          </label>
          <span className="text-[11px] text-slate-400">10 – 80 ảnh (Mục tiêu 30-45 giây)</span>
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
          <span className="w-12 text-center text-xs font-bold text-cyan-300 bg-slate-800 px-2 py-1 rounded-lg border border-slate-700">
            {crawlCount}
          </span>
        </div>

        {/* Quick presets */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[10px] text-slate-400 font-medium">Chọn nhanh:</span>
          {[
            { count: 20, label: "20 ảnh (Cực nhanh ~15s)" },
            { count: 40, label: "40 ảnh (Chuẩn ~30s - Đề xuất)", highlight: true },
            { count: 60, label: "60 ảnh (~45s)" },
            { count: 80, label: "80 ảnh (Tối đa ~60s)" },
          ].map((preset) => (
            <button
              key={preset.count}
              type="button"
              disabled={isBusy}
              onClick={() => onCrawlCountChange?.(preset.count)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                crawlCount === preset.count
                  ? "bg-cyan-500 text-slate-950 font-bold shadow"
                  : preset.highlight
                  ? "border border-cyan-800/80 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/60"
                  : "border border-slate-800 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white"
              } disabled:opacity-50`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Ảnh phòng / Bối cảnh mẫu tham chiếu để ghép Mockup AI */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-purple-500/30 bg-purple-950/15 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🛋️</span>
            <div>
              <h3 className="text-xs font-bold text-purple-200 flex items-center gap-1.5">
                <span>3. Ảnh phòng / Bối cảnh mẫu để ghép Mockup AI</span>
                <span className="text-[10px] font-normal text-purple-400/80">(Tùy chọn)</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Nạp ảnh phòng chụp thực tế của bạn để AI ghép hoa văn cào được vào đúng sản phẩm trong phòng.
              </p>
            </div>
          </div>
          {referenceImages.length > 0 && (
            <span className="rounded-full bg-purple-500/30 border border-purple-400/40 px-2 py-0.5 text-[10px] font-bold text-purple-200">
              ✓ Đã nạp {referenceImages.length} phòng mẫu
            </span>
          )}
        </div>

        <ReferenceDropzone
          images={referenceImages}
          onChange={onReferenceImagesChange}
          disabled={isBusy}
          maxImages={10}
        />

        <div className="rounded-lg border border-purple-900/40 bg-purple-950/30 p-2.5 text-[11px] text-purple-200/90 leading-relaxed">
          {referenceImages.length > 0 ? (
            <span>
              ✓ <strong>Chế độ ghép phòng chỉ định:</strong> AI sẽ giữ nguyên {referenceImages.length} căn phòng trên và ghép hoa văn đã chọn lên sản phẩm để render Mockup chân thực nhất.
            </span>
          ) : (
            <span>
              ℹ️ <strong>Chưa nạp ảnh phòng riêng:</strong> Hệ thống sẽ tự động tạo bối cảnh phòng cao cấp ngẫu nhiên. Ngoài ra, tại <strong>Bước 2 (Duyệt mẫu)</strong>, bạn cũng có thể bấm nút <em>&ldquo;Làm phòng&rdquo;</em> trên bất kỳ ảnh Pinterest nào cào về để dùng làm phôi bối cảnh!
            </span>
          )}
        </div>
      </div>

      {/* Multi-Query Matrix Quick Toggle Banner */}
      <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border p-3.5 transition ${
        isMatrixMode
          ? "border-cyan-500/80 bg-gradient-to-r from-cyan-950/60 via-indigo-950/50 to-blue-950/60 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-500/40"
          : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
      }`}>
        <div className="flex items-center gap-2.5">
          <span className="text-xl">🌐</span>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100">
                Chế độ Quét Ma trận Toàn cầu (Multi-Market Matrix)
              </span>
              <span className={`rounded-full px-2 py-0.2 text-[9px] font-bold ${
                isMatrixMode
                  ? "bg-cyan-500/30 text-cyan-300 border border-cyan-400/50 animate-pulse"
                  : "bg-slate-800 text-slate-400"
              }`}>
                {isMatrixMode ? "🔥 ĐANG BẬT: 18 API CALLS" : "1 API CALL (Đơn lẻ)"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {isMatrixMode
                ? "Quét đồng thời 3 loại xu hướng × 6 thị trường lớn (US, CA, DE, FR, ES, IT) qua Multi-Threading ~2.5s, tự động gom ~900 từ khóa & xếp hạng."
                : "Chỉ quét 1 thị trường & 1 loại xu hướng đơn lẻ. Bấm nút bên cạnh để kích hoạt quét ma trận toàn diện 18 calls."}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={isBusy}
          onClick={handleToggleMatrixMode}
          className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            isMatrixMode
              ? "bg-cyan-500 text-slate-950 shadow hover:bg-cyan-400"
              : "border border-cyan-800/80 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/60 hover:text-white"
          } disabled:opacity-50`}
        >
          <span>{isMatrixMode ? "✓ Đang kích hoạt 18 calls" : "🚀 Bật Quét Ma trận (18 calls)"}</span>
        </button>
      </div>

      {/* Main Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <button
          type="button"
          onClick={onDiscoverTrends ?? onStartCrawl}
          disabled={isBusy || !niche.trim()}
          className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 p-3 text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-500 hover:to-indigo-500 hover:shadow-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          <div className="flex items-center gap-2 text-sm font-bold">
            <span>✨</span>
            <span>{isDiscoveringTrends ? "Đang phân tích xu hướng..." : "Khám phá Xu hướng (Tier 1 & 2)"}</span>
          </div>
          <span className="text-[10px] text-cyan-200/90 font-normal">
            {isMatrixMode
              ? "Quét ma trận 18 calls toàn cầu, AI lọc & nhóm 3-5 cụm chủ đề chuẩn in ấn"
              : "Phân tích cụm chủ đề AI, lọc từ khóa phi ấn phẩm & chọn cụm cào"}
          </span>
        </button>

        <button
          type="button"
          onClick={onStartCrawl}
          disabled={isBusy || !niche.trim()}
          className="flex flex-col items-center justify-center gap-0.5 rounded-xl border border-emerald-500/50 bg-emerald-950/30 p-3 text-emerald-300 shadow transition hover:border-emerald-400 hover:bg-emerald-900/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          <div className="flex items-center gap-2 text-sm font-bold">
            <span>⚡</span>
            <span>{jobStatus === "running" ? "Đang cào dữ liệu..." : "Quick Auto Crawl (Cào nhanh)"}</span>
          </div>
          <span className="text-[10px] text-emerald-400/80 font-normal">
            Cào trực tiếp {crawlCount} ảnh Pinterest & chấm điểm AI tức thì
          </span>
        </button>
      </div>

      {isBusy && (
        <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/70 p-3">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
            <span>Tiến trình đang chạy ngầm... Bạn có thể theo dõi thanh trạng thái bên dưới.</span>
          </div>
          <button
            type="button"
            onClick={onStopJob}
            className="flex items-center gap-1 rounded-lg border border-rose-700/60 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-900/60 hover:text-white cursor-pointer"
          >
            <span>⏹</span>
            <span>Dừng Job</span>
          </button>
        </div>
      )}

      {/* Collapsible Advanced Pinterest Settings */}
      <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/60">
        <button
          type="button"
          onClick={() => setIsAdvancedOpen((prev) => !prev)}
          className="flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span>⚙️</span>
            <span>Cài đặt nâng cao Pinterest API (Tùy chọn)</span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-cyan-300 font-mono">
              {region} • {trendType} • {activeProduct.toUpperCase()}
            </span>
          </div>
          <span className="text-slate-400 text-sm font-bold">
            {isAdvancedOpen ? "▲" : "▼"}
          </span>
        </button>

        {isAdvancedOpen && (
          <div className="flex flex-col gap-4 border-t border-slate-800 p-4 pt-3">
            {/* Override Product Type Selector */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>📦 Ghi đè loại phôi sản phẩm:</span>
                <span className="text-[11px] text-slate-400">Chọn phôi in xưởng mong muốn</span>
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PRODUCT_OPTIONS.map((opt) => {
                  const isSelected = activeProduct === opt.type;
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleSelectProduct(opt.type)}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-2 text-left transition cursor-pointer ${
                        isSelected
                          ? "border-cyan-500 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-500/50 shadow"
                          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:bg-slate-800/70 hover:text-slate-200"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-base">{opt.icon}</span>
                        {isSelected && (
                          <span className="rounded-full bg-cyan-500/20 px-1 py-0.2 text-[8px] font-bold text-cyan-300">
                            ✓ Đang chọn
                          </span>
                        )}
                      </div>
                      <strong className={`text-xs font-bold ${isSelected ? "text-cyan-200" : "text-slate-200"}`}>
                        {opt.label}
                      </strong>
                      <span className="text-[9px] text-slate-400 line-clamp-1">{opt.standard}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pinterest API Filters: Trend Type, Interest, Region */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Trend Type */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="trend-type-select" className="text-xs font-semibold text-slate-300">
                  📈 Loại xu hướng (Trend Type)
                </label>
                <select
                  id="trend-type-select"
                  value={trendType}
                  onChange={(e) => onTrendTypeChange?.(e.target.value as "growing" | "monthly" | "seasonal" | "ALL")}
                  disabled={isBusy}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-400 focus:outline-none disabled:opacity-50"
                >
                  <option value="ALL">🔥 Tất cả 3 loại xu hướng (Growing + Monthly + Seasonal - Quét Ma trận)</option>
                  <option value="growing">Đang tăng trưởng mạnh (Growing)</option>
                  <option value="monthly">Xu hướng hàng tháng (Monthly)</option>
                  <option value="seasonal">Xu hướng theo mùa vụ (Seasonal)</option>
                </select>
              </div>

              {/* Interest */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="interest-select" className="text-xs font-semibold text-slate-300">
                  🏷️ Ngành hàng (Pinterest Interest)
                </label>
                <select
                  id="interest-select"
                  value={interest}
                  onChange={(e) => onInterestChange?.(e.target.value)}
                  disabled={isBusy}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-400 focus:outline-none disabled:opacity-50"
                >
                  <option value="">Tất cả ngành hàng (Tự động)</option>
                  <option value="womens_fashion">Thời trang & Phụ kiện (womens_fashion)</option>
                  <option value="home_decor">Trang trí nội thất (home_decor)</option>
                  <option value="art">Nghệ thuật & Thiết kế (art)</option>
                  <option value="diy_and_crafts">Thủ công DIY (diy_and_crafts)</option>
                </select>
              </div>

              {/* Region */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="region-select" className="text-xs font-semibold text-slate-300">
                  🌍 Thị trường / Quốc gia (Region)
                </label>
                <select
                  id="region-select"
                  value={region}
                  onChange={(e) => onRegionChange?.(e.target.value)}
                  disabled={isBusy}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-400 focus:outline-none disabled:opacity-50"
                >
                  <option value="ALL">🌍 Tất cả 6 thị trường lớn (US, CA, DE, FR, ES, IT - Quét Ma trận)</option>
                  <option value="US">Hoa Kỳ (United States - US) 🇺🇸</option>
                  <option value="CA">Canada (CA) 🇨🇦</option>
                  <option value="DE">Đức (Germany - DE) 🇩🇪</option>
                  <option value="FR">Pháp (France - FR) 🇫🇷</option>
                  <option value="ES">Tây Ban Nha (Spain - ES) 🇪🇸</option>
                  <option value="IT">Ý (Italy - IT) 🇮🇹</option>
                  <option value="GB">Vương Quốc Anh (United Kingdom - GB) 🇬🇧</option>
                  <option value="AU">Úc (Australia - AU) 🇦🇺</option>
                </select>
              </div>
            </div>

            {/* Dynamic Matrix Execution Preview */}
            <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-2.5 text-xs text-cyan-200/90 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span>⚡</span>
                <span>
                  Kế hoạch truy vấn:{" "}
                  <strong className="text-cyan-300">
                    {isMatrixMode
                      ? "18 API calls đồng thời (3 loại xu hướng × 6 thị trường lớn)"
                      : trendType === "ALL"
                      ? `3 API calls đồng thời (3 loại xu hướng tại ${region})`
                      : region.toUpperCase() === "ALL"
                      ? `6 API calls đồng thời (6 thị trường lớn cho loại ${trendType})`
                      : `1 API call đơn lẻ (${trendType} tại ${region})`}
                  </strong>
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                {isMatrixMode ? "~2.5s qua Multi-Threading" : "~1.5s"}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
