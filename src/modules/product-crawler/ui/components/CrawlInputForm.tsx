import { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import { parseInputLines } from "../../service";
import {
  DEFAULT_CRAWLER_OPTIONS,
  type ProductCrawlerJobInput,
  type ProductCrawlerOptions,
} from "../../types";

interface CrawlInputFormProps {
  isLoading: boolean;
  onSubmit(input: ProductCrawlerJobInput): void;
}

export function CrawlInputForm({ isLoading, onSubmit }: CrawlInputFormProps): React.JSX.Element {
  const [rawText, setRawText] = useState<string>(
    "B0GQ33XWW7\nhttps://www.amazon.com/dp/B08XY12345\nB09PQ56789\nB07ZZ99881",
  );
  const [crawlMode, setCrawlMode] = useState<"exact" | "group">("group");
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [options, setOptions] = useState<ProductCrawlerOptions>(DEFAULT_CRAWLER_OPTIONS);
  const [showValidation, setShowValidation] = useState(false);

  const parsedRows = parseInputLines(rawText);
  const validRows = parsedRows.filter((r) => r.isValid);
  const invalidRows = parsedRows.filter((r) => !r.isValid);

  const handleLoadSample = (): void => {
    setRawText("B0GQ33XWW7\nhttps://www.amazon.com/dp/B08XY12345\nB09PQ56789\nB07ZZ99881");
    setShowValidation(true);
  };

  const handleValidateClick = (): void => {
    setShowValidation(true);
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (validRows.length === 0) {
      setShowValidation(true);
      return;
    }

    const payload: ProductCrawlerJobInput = {
      source: "amazon",
      inputs: validRows.map((r) => ({
        type: r.type === "url" ? "url" : "asin",
        value: r.value,
      })),
      crawlMode,
      options,
    };

    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-700 text-xs font-bold">
                1
              </span>
              Nhập danh sách Amazon ASIN hoặc URL
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Hỗ trợ nhập trực tiếp mã ASIN 10 ký tự hoặc đường dẫn chi tiết sản phẩm Amazon. Mỗi mục một dòng.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {rawText.trim() && (
              <button
                type="button"
                onClick={() => {
                  setRawText("");
                  setShowValidation(false);
                }}
                className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                ✕ Xóa trắng
              </button>
            )}

            <button
              type="button"
              onClick={handleLoadSample}
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <AppIcon name="queue" /> Tải dữ liệu mẫu
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-5">
          {/* Input text area */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <label htmlFor="crawler-input-textarea" className="font-medium text-slate-700">
                Danh sách ASIN / URLs
              </label>
              <div className="flex items-center gap-2">
                <span className="text-blue-700 font-mono font-semibold">{validRows.length} hợp lệ</span>
                {invalidRows.length > 0 && (
                  <span className="text-rose-700 font-mono">({invalidRows.length} lỗi/trùng)</span>
                )}
              </div>
            </div>

            <textarea
              id="crawler-input-textarea"
              rows={6}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setShowValidation(false);
              }}
              placeholder={`B0GQ33XWW7\nhttps://www.amazon.com/dp/B08XY12345\nB09PQ56789`}
              className="w-full rounded-lg border border-slate-300 bg-white p-3.5 font-mono text-xs text-slate-900 placeholder-slate-600 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300"
            />

            {/* Validation feedback */}
            {showValidation && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
                <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <span>Kết quả kiểm tra dữ liệu:</span>
                </div>
                {validRows.length > 0 && (
                  <div className="text-emerald-700">
                    ✓ Đã nhận diện {validRows.length} mục hợp lệ: {validRows.map((r) => r.extractedAsin || r.value).join(", ")}
                  </div>
                )}
                {invalidRows.length > 0 && (
                  <div className="text-rose-700 space-y-0.5">
                    ✕ Phát hiện {invalidRows.length} mục không hợp lệ:
                    {invalidRows.map((r, i) => (
                      <div key={i} className="pl-3 text-xs text-rose-700">
                        • &quot;{r.raw}&quot;: {r.error}
                      </div>
                    ))}
                  </div>
                )}
                {parsedRows.length === 0 && (
                  <div className="text-amber-700">Chưa có dữ liệu nào được nhập.</div>
                )}
              </div>
            )}
          </div>

          {/* Crawl Mode & Settings */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-700 block mb-2">Chế độ cào (Crawl Mode)</label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 cursor-pointer hover:border-slate-300 transition">
                  <input
                    type="radio"
                    name="crawlMode"
                    value="group"
                    checked={crawlMode === "group"}
                    onChange={() => setCrawlMode("group")}
                    className="mt-0.5 text-blue-700 focus:ring-blue-300"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-900 block">Variant Group (Khuyên dùng)</span>
                    <span className="text-xs text-slate-600 block mt-0.5">
                      Cào toàn bộ nhóm biến thể, kích cỡ, màu sắc và tùy biến liên quan của sản phẩm.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 cursor-pointer hover:border-slate-300 transition">
                  <input
                    type="radio"
                    name="crawlMode"
                    value="exact"
                    checked={crawlMode === "exact"}
                    onChange={() => setCrawlMode("exact")}
                    className="mt-0.5 text-blue-700 focus:ring-blue-300"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-900 block">Exact ASIN</span>
                    <span className="text-xs text-slate-600 block mt-0.5">
                      Chỉ cào đúng ASIN được chỉ định, bỏ qua ma trận biến thể phụ.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Quick summary box */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
              <div className="flex justify-between">
                <span>Nguồn crawl:</span>
                <span className="font-semibold text-amber-700">Amazon US</span>
              </div>
              <div className="flex justify-between">
                <span>Mã ZIP giao hàng:</span>
                <span className="font-mono text-slate-900">{options.amazonZip || "10001"}</span>
              </div>
              <div className="flex justify-between">
                <span>Trình duyệt:</span>
                <span className="text-slate-900">{options.headless ? "Headless (Ẩn)" : "Hiển thị (Trực quan)"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Advanced Settings */}
        <div className="border-t border-slate-200 mt-5 pt-4">
          <button
            type="button"
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-700 transition"
          >
            <span className="text-xs">{isAdvancedOpen ? "▼" : "▶"}</span>
            Cấu hình nâng cao (Advanced Crawler Settings)
          </button>

          {isAdvancedOpen && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div>
                <label className="text-xs text-slate-600 block mb-1">Mã ZIP Amazon</label>
                <input
                  type="text"
                  value={options.amazonZip ?? "10001"}
                  onChange={(e) => setOptions({ ...options, amazonZip: e.target.value })}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 block mb-1">Luồng sản phẩm (Product Threads)</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={options.productThreads ?? 3}
                  onChange={(e) => setOptions({ ...options, productThreads: Number(e.target.value) })}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 block mb-1">Luồng biến thể (Variant Threads)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={options.variantThreads ?? 5}
                  onChange={(e) => setOptions({ ...options, variantThreads: Number(e.target.value) })}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 block mb-1">Max Matrix Variants</label>
                <input
                  type="number"
                  min={5}
                  max={200}
                  value={options.maxMatrixVariants ?? 50}
                  onChange={(e) => setOptions({ ...options, maxMatrixVariants: Number(e.target.value) })}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 block mb-1">Số tab trình duyệt (Browser Tabs)</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={options.browserTabs ?? 3}
                  onChange={(e) => setOptions({ ...options, browserTabs: Number(e.target.value) })}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 block mb-1">Captcha Timeout (giây)</label>
                <input
                  type="number"
                  min={10}
                  max={300}
                  value={options.captchaTimeoutSeconds ?? 60}
                  onChange={(e) => setOptions({ ...options, captchaTimeoutSeconds: Number(e.target.value) })}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 block mb-1">Profile Slug</label>
                <input
                  type="text"
                  value={options.profileSlug ?? "default"}
                  onChange={(e) => setOptions({ ...options, profileSlug: e.target.value })}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                />
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(options.headless)}
                    onChange={(e) => setOptions({ ...options, headless: e.target.checked })}
                    className="rounded border-slate-300 text-blue-700 focus:ring-blue-300"
                  />
                  <span className="text-xs text-slate-700">Chạy Headless (Không mở cửa sổ)</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-5 border-t border-slate-200">
          <button
            type="button"
            onClick={handleValidateClick}
            className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
          >
            Kiểm tra cú pháp
          </button>

          <button
            type="submit"
            disabled={validRows.length === 0 || isLoading}
            className="flex items-center gap-2 rounded-lg bg-blue-50 px-6 py-2.5 text-xs font-bold text-slate-950 shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-transparent" />
                Đang khởi tạo job...
              </>
            ) : (
              <>
                <span>▶</span> Bắt đầu cào sản phẩm ({validRows.length})
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
