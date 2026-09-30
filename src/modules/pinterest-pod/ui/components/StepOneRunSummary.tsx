import type { PinterestProductType } from "../../types";

interface StepOneRunSummaryProps {
  readonly niche: string;
  readonly product: PinterestProductType;
  readonly crawlCount: number;
  readonly referenceImageCount: number;
  readonly regionCount: number;
  readonly trendTypeCount: number;
  readonly canDiscoverOfficialTrends: boolean;
  readonly isAgentConnected: boolean;
  readonly isAgentBrowserLoggedIn: boolean;
}

const PRODUCT_LABELS: Readonly<Record<PinterestProductType, string>> = {
  bag: "Túi / Tote",
  rug: "Thảm",
  blanket: "Chăn",
  custom: "Tùy biến",
};

interface SummaryRowProps {
  readonly label: string;
  readonly value: string;
}

function SummaryRow({ label, value }: SummaryRowProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 py-2.5 last:border-b-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="max-w-[65%] text-right text-xs font-semibold text-slate-200">{value}</dd>
    </div>
  );
}

export function StepOneRunSummary({
  niche,
  product,
  crawlCount,
  referenceImageCount,
  regionCount,
  trendTypeCount,
  canDiscoverOfficialTrends,
  isAgentConnected,
  isAgentBrowserLoggedIn,
}: StepOneRunSummaryProps): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      <div className="border-b border-slate-800 pb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">Tóm tắt lần chạy</p>
        <h2 className="mt-1 text-base font-bold text-slate-100">Kiểm tra trước khi bắt đầu</h2>
      </div>

      <dl className="mt-2">
        <SummaryRow label="Chủ đề" value={niche.trim() || "Chưa nhập"} />
        <SummaryRow label="Sản phẩm" value={PRODUCT_LABELS[product]} />
        <SummaryRow label="Phạm vi Trend" value={`${regionCount} thị trường · ${trendTypeCount} loại xu hướng`} />
        <SummaryRow label="Khối lượng cào" value={`${crawlCount} ảnh`} />
        <SummaryRow
          label="Bối cảnh mockup"
          value={referenceImageCount > 0 ? `${referenceImageCount} ảnh đã tải` : "Hệ thống tự tạo"}
        />
      </dl>

      <div className="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex items-start gap-2 text-xs">
          <span
            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${canDiscoverOfficialTrends ? "bg-emerald-400" : "bg-amber-400"}`}
          />
          <div>
            <p className="font-semibold text-slate-200">
              Pinterest API: {canDiscoverOfficialTrends ? "Sẵn sàng quét Trends" : "Chưa kết nối OAuth"}
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Chỉ dùng cho dữ liệu Pinterest Trends chính thức.</p>
          </div>
        </div>
        <div className="flex items-start gap-2 border-t border-slate-800 pt-2 text-xs">
          <span
            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${isAgentConnected && isAgentBrowserLoggedIn ? "bg-emerald-400" : "bg-slate-500"}`}
          />
          <div>
            <p className="font-semibold text-slate-200">
              Crawler Agent:{" "}
              {!isAgentConnected
                ? "Chưa kết nối"
                : isAgentBrowserLoggedIn
                  ? "Sẵn sàng cào ảnh"
                  : "Chưa đăng nhập browser"}
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Không chặn quét Trends; chỉ cần khi bắt đầu cào ảnh.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
