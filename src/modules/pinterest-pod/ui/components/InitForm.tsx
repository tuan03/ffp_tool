import { useEffect, useState } from "react";
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

export const AVAILABLE_REGIONS = [
  { code: "US", label: "Hoa Kỳ", flag: "🇺🇸", regionGroup: "Bắc Mỹ" },
  { code: "CA", label: "Canada", flag: "🇨🇦", regionGroup: "Bắc Mỹ" },
  { code: "DE", label: "Đức", flag: "🇩🇪", regionGroup: "Châu Âu" },
  { code: "FR", label: "Pháp", flag: "🇫🇷", regionGroup: "Châu Âu" },
  { code: "ES", label: "Tây Ban Nha", flag: "🇪🇸", regionGroup: "Châu Âu" },
  { code: "IT", label: "Ý", flag: "🇮🇹", regionGroup: "Châu Âu" },
  { code: "MX", label: "Mexico", flag: "🇲🇽", regionGroup: "Mỹ Latinh" },
  { code: "BR", label: "Brazil", flag: "🇧🇷", regionGroup: "Mỹ Latinh" },
  { code: "GB", label: "Vương Quốc Anh", flag: "🇬🇧", regionGroup: "Châu Âu" },
  { code: "AU", label: "Úc", flag: "🇦🇺", regionGroup: "Châu Đại Dương" },
] as const;

export const AVAILABLE_TREND_TYPES = [
  { type: "growing" as const, label: "Tăng trưởng nhanh", icon: "🔥", desc: "Xu hướng tăng mạnh gần đây" },
  { type: "monthly" as const, label: "Hàng tháng", icon: "📅", desc: "Xu hướng ổn định bền vững" },
  { type: "seasonal" as const, label: "Theo mùa vụ", icon: "🍂", desc: "Xu hướng lễ hội & mùa" },
] as const;

export const AVAILABLE_INTERESTS = [
  { id: "", label: "Tự động theo niche", icon: "✨" },
  { id: "art", label: "Nghệ thuật & Thiết kế", icon: "🎨" },
  { id: "home_decor", label: "Trang trí nội thất", icon: "🛋️" },
  { id: "womens_fashion", label: "Thời trang & Phụ kiện", icon: "👗" },
  { id: "diy_and_crafts", label: "Thủ công DIY", icon: "✂️" },
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
  /** Multi-select Dynamic Matrix support */
  readonly selectedRegions?: readonly string[];
  readonly onSelectedRegionsChange?: (regions: readonly string[]) => void;
  readonly selectedTrendTypes?: readonly ("growing" | "monthly" | "seasonal")[];
  readonly onSelectedTrendTypesChange?: (types: readonly ("growing" | "monthly" | "seasonal")[]) => void;
  readonly selectedInterests?: readonly string[];
  readonly onSelectedInterestsChange?: (interests: readonly string[]) => void;
  /** Trend discovery trigger */
  readonly onDiscoverTrends?: () => void;
  readonly onSuggestThemes?: () => void;
  readonly canDiscoverOfficialTrends?: boolean;
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
  selectedRegions,
  onSelectedRegionsChange,
  selectedTrendTypes,
  onSelectedTrendTypesChange,
  selectedInterests,
  onSelectedInterestsChange,
  onDiscoverTrends,
  onSuggestThemes,
  canDiscoverOfficialTrends = false,
  isDiscoveringTrends = false,
}: InitFormProps): React.JSX.Element {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isCrawlSettingsOpen, setIsCrawlSettingsOpen] = useState(false);
  const [isMockupSettingsOpen, setIsMockupSettingsOpen] = useState(false);
  const [overrideProduct, setOverrideProduct] = useState(false);

  const currentRegions = selectedRegions && selectedRegions.length > 0
    ? selectedRegions
    : region.toUpperCase() === "ALL"
    ? ["US", "CA", "DE", "FR", "ES", "IT"]
    : [region];

  const currentTrendTypes = selectedTrendTypes && selectedTrendTypes.length > 0
    ? selectedTrendTypes
    : trendType === "ALL"
    ? (["growing", "monthly", "seasonal"] as const)
    : ([trendType as "growing" | "monthly" | "seasonal"] as const);

  const currentInterests = selectedInterests && selectedInterests.length > 0
    ? selectedInterests
    : (interest ? [interest] : []);

  const totalCalculatedQueries = currentRegions.length * currentTrendTypes.length * (currentInterests.length || 1);
  const estimatedSeconds = Math.max(1, Math.round(totalCalculatedQueries * 0.15 + 1.0));

  const handleToggleRegion = (code: string): void => {
    const isPresent = currentRegions.includes(code);
    let next: string[];
    if (isPresent) {
      if (currentRegions.length <= 1) return;
      next = currentRegions.filter((r) => r !== code);
    } else {
      next = [...currentRegions, code];
    }
    onSelectedRegionsChange?.(next);
    if (next.length >= 6) {
      onRegionChange?.("ALL");
    } else {
      onRegionChange?.(next[0] || "US");
    }
  };

  const handleToggleTrendType = (t: "growing" | "monthly" | "seasonal"): void => {
    const isPresent = currentTrendTypes.includes(t);
    let next: ("growing" | "monthly" | "seasonal")[];
    if (isPresent) {
      if (currentTrendTypes.length <= 1) return;
      next = currentTrendTypes.filter((item) => item !== t);
    } else {
      next = [...currentTrendTypes, t];
    }
    onSelectedTrendTypesChange?.(next);
    if (next.length === 3) {
      onTrendTypeChange?.("ALL");
    } else {
      onTrendTypeChange?.(next[0] || "growing");
    }
  };

  const handleToggleInterest = (itId: string): void => {
    if (!itId) {
      onSelectedInterestsChange?.([]);
      onInterestChange?.("");
      return;
    }
    const isPresent = currentInterests.includes(itId);
    let next: string[];
    if (isPresent) {
      next = currentInterests.filter((item) => item !== itId);
    } else {
      next = [...currentInterests, itId];
    }
    onSelectedInterestsChange?.(next);
    onInterestChange?.(next.length === 1 ? next[0] : "");
  };

  const handleApplyPreset = (presetName: "global" | "na" | "eu" | "single"): void => {
    if (presetName === "global") {
      const allR = ["US", "CA", "DE", "FR", "ES", "IT"];
      const allT: ("growing" | "monthly" | "seasonal")[] = ["growing", "monthly", "seasonal"];
      onSelectedRegionsChange?.(allR);
      onSelectedTrendTypesChange?.(allT);
      onRegionChange?.("ALL");
      onTrendTypeChange?.("ALL");
    } else if (presetName === "na") {
      const naR = ["US", "CA"];
      const naT: ("growing" | "monthly" | "seasonal")[] = ["growing", "seasonal"];
      onSelectedRegionsChange?.(naR);
      onSelectedTrendTypesChange?.(naT);
      onRegionChange?.("US");
      onTrendTypeChange?.("growing");
    } else if (presetName === "eu") {
      const euR = ["DE", "FR", "ES", "IT"];
      const euT: ("growing" | "monthly" | "seasonal")[] = ["growing", "monthly"];
      onSelectedRegionsChange?.(euR);
      onSelectedTrendTypesChange?.(euT);
      onRegionChange?.("DE");
      onTrendTypeChange?.("growing");
    } else if (presetName === "single") {
      onSelectedRegionsChange?.(["US"]);
      onSelectedTrendTypesChange?.(["growing"]);
      onRegionChange?.("US");
      onTrendTypeChange?.("growing");
    }
  };

  const isBusy = jobStatus === "running" || jobStatus === "producing" || isDiscoveringTrends;
  const inferredProduct = niche.trim() ? inferProductTypeFromNiche(niche) : "bag";
  const activeProduct = overrideProduct && product ? product : inferredProduct;

  const currentProductOption = PRODUCT_OPTIONS.find((p) => p.type === activeProduct) ?? PRODUCT_OPTIONS[0];

  useEffect(() => {
    if (!overrideProduct) {
      onProductChange?.(inferredProduct);
    }
  }, [inferredProduct, onProductChange, overrideProduct]);

  const handleSelectProduct = (newProduct: PinterestProductType): void => {
    setOverrideProduct(true);
    onProductChange?.(newProduct);
  };

  const handleResetToAutoInferred = (): void => {
    setOverrideProduct(false);
    onProductChange?.(inferredProduct);
  };

  const handleNicheChange = (nextNiche: string): void => {
    onNicheChange(nextNiche);
    if (!overrideProduct) {
      onProductChange?.(nextNiche.trim() ? inferProductTypeFromNiche(nextNiche) : "bag");
    }
  };

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-lg text-cyan-300">1</span>
          <div>
            <h2 className="text-base font-bold text-slate-100">Thiết lập lần chạy Pinterest POD</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Nhập toàn bộ thông tin một lần. Hệ thống sẽ dùng chúng cho quét Trend, cào ảnh và tạo mockup ở các bước tiếp theo.
            </p>
          </div>
        </div>
        <span className="self-start rounded-full border border-emerald-800/70 bg-emerald-950/50 px-3 py-1 text-[11px] font-semibold text-emerald-300 sm:self-center">
          Nhập một lần · Chạy xuyên suốt
        </span>
      </div>

      {/* 1. Primary Niche Input */}
      <div data-testid="step-one-topic" className="order-1 flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">A · Chủ đề và sản phẩm</p>
          <p className="mt-1 text-xs text-slate-400">Xác định nội dung cần nghiên cứu và phôi sản phẩm đích.</p>
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="niche-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <span>Từ khóa Pinterest niche / chủ đề xu hướng</span>
            <span className="text-rose-400">*</span>
          </label>
          <span className="text-[11px] text-slate-400">Nhập bất kỳ sản phẩm hoặc phong cách nghệ thuật</span>
        </div>

        <div className="relative">
          <input
            id="niche-input"
            type="text"
            value={niche}
            onChange={(e) => handleNicheChange(e.target.value)}
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
              onClick={() => handleNicheChange(chip)}
              className="rounded-full border border-slate-800 bg-slate-800/60 px-2.5 py-0.5 text-[11px] text-slate-300 transition hover:border-cyan-500 hover:bg-slate-700 hover:text-cyan-300 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Số lượng ảnh cào từ Pinterest (Crawl Pool Size) */}
      <div data-testid="step-one-crawl-settings" className="order-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
        <button
          type="button"
          aria-expanded={isCrawlSettingsOpen}
          aria-controls="crawl-settings-content"
          onClick={() => setIsCrawlSettingsOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-slate-900/70"
        >
          <span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">C · Cấu hình cào ảnh</span>
            <span className="mt-1 block text-xs text-slate-400">
              Crawler Agent sẽ thu thập <strong className="text-slate-200">{crawlCount} ảnh</strong> sau khi chọn Trend.
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-cyan-900 bg-cyan-950/60 px-2.5 py-1 text-[11px] font-bold text-cyan-300">
              {crawlCount} ảnh
            </span>
            <span className="text-xs font-bold text-slate-500">{isCrawlSettingsOpen ? "▲" : "▼"}</span>
          </span>
        </button>

        {isCrawlSettingsOpen && (
          <div id="crawl-settings-content" className="flex flex-col gap-3 border-t border-slate-800 p-4">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <label htmlFor="crawl-count-input" className="text-xs font-semibold text-slate-200">
                Số lượng ảnh cào về từ Pinterest
              </label>
              <span className="text-[11px] text-slate-400">10 – 500+ ảnh (Tùy chỉnh linh hoạt)</span>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <input
                id="crawl-count-input"
                type="range"
                min={10}
                max={300}
                step={10}
                value={Math.min(300, crawlCount)}
                onChange={(e) => onCrawlCountChange?.(Number(e.target.value))}
                disabled={isBusy}
                className="flex-1 accent-cyan-400 h-2 bg-slate-700 rounded-lg cursor-pointer disabled:opacity-50"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="number"
                  min={10}
                  max={1000}
                  step={10}
                  value={crawlCount}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (!Number.isNaN(value)) {
                      onCrawlCountChange?.(Math.max(10, Math.min(1000, value)));
                    }
                  }}
                  disabled={isBusy}
                  aria-label="Số lượng ảnh cào"
                  className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-center text-xs font-bold text-cyan-300 focus:border-cyan-400 focus:outline-none disabled:opacity-50"
                />
                <span className="text-xs text-slate-400">ảnh</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[10px] text-slate-400 font-medium">Chọn nhanh:</span>
              {[
                { count: 40, label: "40 ảnh (~30s - Thử nhanh)" },
                { count: 80, label: "80 ảnh (~1m - Chuẩn đề xuất)", highlight: true },
                { count: 150, label: "150 ảnh (~2m - Mở rộng)" },
                { count: 250, label: "250 ảnh (~3m - Quy mô lớn)" },
                { count: 400, label: "400 ảnh (~5m - Kho cực đại)" },
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
        )}
      </div>

      {/* 3. Ảnh phòng / Bối cảnh mẫu tham chiếu để ghép Mockup AI */}
      <div data-testid="step-one-mockup-settings" className="order-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
        <button
          type="button"
          aria-expanded={isMockupSettingsOpen}
          aria-controls="mockup-settings-content"
          onClick={() => setIsMockupSettingsOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-slate-900/70"
        >
          <span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">D · Dữ liệu cho mockup</span>
            <span className="mt-1 block text-xs text-slate-400">
              {referenceImages.length > 0
                ? `Đã tải ${referenceImages.length} ảnh phòng tham chiếu.`
                : "Chưa tải ảnh riêng · hệ thống sẽ tự tạo bối cảnh."}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-purple-900 bg-purple-950/50 px-2.5 py-1 text-[11px] font-semibold text-purple-200">
              {referenceImages.length > 0 ? `${referenceImages.length} ảnh` : "Tùy chọn"}
            </span>
            <span className="text-xs font-bold text-slate-500">{isMockupSettingsOpen ? "▲" : "▼"}</span>
          </span>
        </button>

        {isMockupSettingsOpen && (
          <div id="mockup-settings-content" className="flex flex-col gap-3 border-t border-slate-800 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🛋️</span>
                <div>
                  <h3 className="text-xs font-bold text-slate-200">Ảnh phòng / Bối cảnh mẫu để ghép Mockup AI</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    AI sẽ ghép hoa văn đã chọn vào sản phẩm trong ảnh phòng của bạn.
                  </p>
                </div>
              </div>
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
                  ✓ <strong>Chế độ ghép phòng chỉ định:</strong> AI sẽ giữ nguyên {referenceImages.length} căn phòng trên và ghép hoa văn đã chọn lên sản phẩm.
                </span>
              ) : (
                <span>
                  ℹ️ <strong>Không bắt buộc:</strong> Nếu để trống, hệ thống sẽ tự tạo bối cảnh. Bạn cũng có thể chọn ảnh làm phòng ở Bước 2.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Dynamic Multi-Market Matrix Preset & Formula Bar */}
      <div data-testid="step-one-trend-scope" className="order-2 flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">B · Phạm vi Pinterest Trends</p>
          <p className="mt-1 text-xs text-slate-400">Chọn nhanh phạm vi phân tích. Thị trường và loại xu hướng chi tiết nằm trong phần nâng cao.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🌐</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-slate-100">Phạm vi phân tích hiện tại</h3>
                <span className="rounded-full bg-cyan-500/20 border border-cyan-400/40 px-2 py-0.2 text-[9px] font-bold text-cyan-300">
                  {currentRegions.length} thị trường · {currentTrendTypes.length} loại xu hướng
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Tự do phối hợp {currentRegions.length} thị trường × {currentTrendTypes.length} loại xu hướng, hoàn toàn linh hoạt không cố định.
              </p>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-1.5 self-end sm:self-center">
            <span className="text-[10px] text-slate-400 font-medium">Chọn nhanh:</span>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleApplyPreset("global")}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-bold border transition cursor-pointer ${
                currentRegions.length === 6 && currentTrendTypes.length === 3
                  ? "bg-cyan-500 text-slate-950 border-cyan-400 shadow font-extrabold"
                  : "border-slate-800 bg-slate-800/60 text-slate-300 hover:border-cyan-500 hover:text-white"
              }`}
            >
              🌍 Toàn cầu (18)
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleApplyPreset("na")}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-bold border transition cursor-pointer ${
                currentRegions.length === 2 && currentRegions.includes("US") && currentRegions.includes("CA") && currentTrendTypes.length === 2
                  ? "bg-cyan-500 text-slate-950 border-cyan-400 shadow font-extrabold"
                  : "border-slate-800 bg-slate-800/60 text-slate-300 hover:border-cyan-500 hover:text-white"
              }`}
            >
              🇺🇸 Bắc Mỹ (4)
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleApplyPreset("eu")}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-bold border transition cursor-pointer ${
                currentRegions.length === 4 && currentRegions.includes("DE") && currentTrendTypes.length === 2
                  ? "bg-cyan-500 text-slate-950 border-cyan-400 shadow font-extrabold"
                  : "border-slate-800 bg-slate-800/60 text-slate-300 hover:border-cyan-500 hover:text-white"
              }`}
            >
              🇪🇺 Châu Âu (8)
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleApplyPreset("single")}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-bold border transition cursor-pointer ${
                currentRegions.length === 1 && currentTrendTypes.length === 1
                  ? "bg-cyan-500 text-slate-950 border-cyan-400 shadow font-extrabold"
                  : "border-slate-800 bg-slate-800/60 text-slate-300 hover:border-cyan-500 hover:text-white"
              }`}
            >
              ⚡ 1 Call
            </button>
          </div>
        </div>

        {/* Live Calculation Formula */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-900/40 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300">
          <div className="flex items-center gap-1.5">
            <span className="text-cyan-400 font-bold">Phạm vi:</span>
            <span>
              <strong className="text-cyan-300">{currentRegions.length} thị trường</strong> ({currentRegions.join(", ")})
              {" × "}
              <strong className="text-indigo-300">{currentTrendTypes.length} loại xu hướng</strong>
              {" = "}
              <strong className="text-emerald-300 font-bold">{totalCalculatedQueries} lượt phân tích</strong>
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            Dự kiến khoảng {estimatedSeconds} giây
          </span>
        </div>
      </div>

      {/* Main Action Buttons */}
      <div data-testid="step-one-run-mode" className="order-6 flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-950/70 p-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">E · Chọn cách bắt đầu</p>
          <p className="mt-1 text-xs text-slate-400">Pinterest Trends là luồng được đề xuất. Các phương án khác không dùng dữ liệu Trends chính thức.</p>
        </div>
        <button
          type="button"
          onClick={onDiscoverTrends ?? onStartCrawl}
          disabled={isBusy || !niche.trim() || !canDiscoverOfficialTrends}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 p-4 text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-500 hover:to-indigo-500 hover:shadow-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          <div className="flex items-center gap-2 text-sm font-bold">
            <span>✨</span>
            <span>
              {isDiscoveringTrends
                ? "Đang phân tích xu hướng..."
                : "Phân tích Pinterest Trends"}
            </span>
          </div>
          <span className="text-[10px] text-cyan-200/90 font-normal">
            {canDiscoverOfficialTrends
              ? `${currentRegions.length} thị trường · ${currentTrendTypes.length} loại xu hướng · dữ liệu Pinterest API chính thức`
              : "Cần kết nối Pinterest OAuth trước"}
          </span>
        </button>

        <div className="flex items-center gap-3 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
          <span className="h-px flex-1 bg-slate-800" />
          <span>Các phương án khác</span>
          <span className="h-px flex-1 bg-slate-800" />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onSuggestThemes}
            disabled={isBusy || !niche.trim()}
            className="flex flex-col items-center justify-center gap-0.5 rounded-xl border border-amber-500/50 bg-amber-950/30 p-3 text-amber-300 shadow transition hover:border-amber-400 hover:bg-amber-900/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <div className="flex items-center gap-2 text-sm font-bold">
              <span>💡</span>
              <span>Gợi ý chủ đề POD nội bộ</span>
            </div>
            <span className="text-[10px] text-amber-400/80 font-normal">
              Không phải dữ liệu Pinterest Trends, không có chỉ số tăng trưởng
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
      </div>

      {isBusy && (
        <div className="order-7 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/70 p-3">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
            <span>Tiến trình đang chạy ngầm... Bạn có thể theo dõi thanh trạng thái bên dưới.</span>
          </div>
          <button
            type="button"
            onClick={onStopJob}
            className="flex items-center gap-1.5 rounded-lg border border-rose-600/70 bg-rose-950/60 px-3 py-1.5 text-xs font-bold text-rose-200 transition hover:bg-rose-900 hover:text-white hover:border-rose-400 cursor-pointer shadow-sm"
          >
            <span>⏹</span>
            <span>Dừng & Mở khóa Form</span>
          </button>
        </div>
      )}

      {/* Collapsible Advanced Pinterest Settings */}
      <div className="order-5 flex flex-col rounded-xl border border-slate-800 bg-slate-950/60">
        <button
          type="button"
          onClick={() => setIsAdvancedOpen((prev) => !prev)}
          className="flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span>⚙️</span>
            <span>Thiết lập phạm vi nâng cao ({currentRegions.length} thị trường • {currentTrendTypes.length} loại xu hướng)</span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-cyan-300 font-mono">
              {totalCalculatedQueries} lượt
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

            {/* 1. Multi-Select Regions Chips */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <span>🌍 1. Thị trường / Quốc gia muốn quét:</span>
                  <span className="text-cyan-400 font-bold">({currentRegions.length} nước)</span>
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      onSelectedRegionsChange?.(AVAILABLE_REGIONS.map((r) => r.code));
                      onRegionChange?.("ALL");
                    }}
                    className="text-[10px] text-cyan-400 hover:underline px-1 cursor-pointer"
                  >
                    Chọn tất cả
                  </button>
                  <span className="text-slate-600">|</span>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      onSelectedRegionsChange?.(["US"]);
                      onRegionChange?.("US");
                    }}
                    className="text-[10px] text-slate-400 hover:underline px-1 cursor-pointer"
                  >
                    Chỉ US
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {AVAILABLE_REGIONS.map((regItem) => {
                  const isChecked = currentRegions.includes(regItem.code);
                  return (
                    <button
                      key={regItem.code}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleToggleRegion(regItem.code)}
                      className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs transition cursor-pointer ${
                        isChecked
                          ? "border-cyan-500 bg-cyan-950/50 text-cyan-200 ring-1 ring-cyan-500/40 font-bold shadow"
                          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      } disabled:opacity-50`}
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span>{regItem.flag}</span>
                        <span className="truncate">{regItem.label}</span>
                      </span>
                      <span className={`text-[10px] font-mono px-1 rounded ${isChecked ? "bg-cyan-500/30 text-cyan-300 font-bold" : "text-slate-500"}`}>
                        {regItem.code}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Multi-Select Trend Types Chips */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <span>📈 2. Loại xu hướng (Trend Types):</span>
                <span className="text-indigo-400 font-bold">({currentTrendTypes.length} loại)</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {AVAILABLE_TREND_TYPES.map((tItem) => {
                  const isChecked = currentTrendTypes.includes(tItem.type);
                  return (
                    <button
                      key={tItem.type}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleToggleTrendType(tItem.type)}
                      className={`flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition cursor-pointer ${
                        isChecked
                          ? "border-indigo-500 bg-indigo-950/40 text-indigo-200 ring-1 ring-indigo-500/40 shadow font-bold"
                          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      } disabled:opacity-50`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs flex items-center gap-1.5">
                          <span>{tItem.icon}</span>
                          <span>{tItem.label}</span>
                        </span>
                        {isChecked && (
                          <span className="text-[10px] text-indigo-300 font-bold">✓ Bật</span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-normal">{tItem.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Interest Selection Chips */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <span>🏷️ 3. Ngành hàng Pinterest (Interest Category):</span>
                <span className="text-slate-400 font-normal">
                  {currentInterests.length === 0 ? "(Tự động mở rộng theo Niche)" : `(${currentInterests.length} ngành)`}
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-1.5">
                {AVAILABLE_INTERESTS.map((itItem) => {
                  const isChecked = itItem.id === ""
                    ? currentInterests.length === 0
                    : currentInterests.includes(itItem.id);
                  return (
                    <button
                      key={itItem.id}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleToggleInterest(itItem.id)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition cursor-pointer ${
                        isChecked
                          ? "border-purple-500 bg-purple-950/50 text-purple-200 ring-1 ring-purple-500/40 font-bold shadow"
                          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      } disabled:opacity-50`}
                    >
                      <span>{itItem.icon}</span>
                      <span>{itItem.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Final Execution Calculation Notice */}
            <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3 text-xs text-cyan-200/90 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-base">🚀</span>
                <span>
                  Tổng phạm vi phân tích:{" "}
                  <strong className="text-cyan-300 text-sm font-mono font-bold">
                    {totalCalculatedQueries} lượt
                  </strong>{" "}
                  ({currentRegions.length} QG × {currentTrendTypes.length} loại xu hướng × {currentInterests.length || 1} ngành)
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Dự kiến khoảng {estimatedSeconds} giây
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
