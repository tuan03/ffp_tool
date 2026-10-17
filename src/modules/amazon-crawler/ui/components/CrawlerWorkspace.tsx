import { useState, type ReactNode } from "react";

export type CrawlerWorkspaceSection = "crawl" | "results" | "agents" | "diagnostics";

interface CrawlerWorkspaceProps {
  section: CrawlerWorkspaceSection;
  onSectionChange: (section: CrawlerWorkspaceSection) => void;
  summary: ReactNode;
  crawl: ReactNode;
  results?: ReactNode;
  agents: ReactNode;
  diagnostics: ReactNode;
}

const WORKSPACE_SECTIONS = [
  {
    id: "crawl",
    step: "1.",
    label: "Cào sản phẩm",
    icon: "M10.5 3.75a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 0 0 0-13.5ZM2.25 10.5a8.25 8.25 0 1 1 14.59 5.28l4.69 4.69a.75.75 0 1 1-1.06 1.06l-4.69-4.69A8.25 8.25 0 0 1 2.25 10.5Z",
  },
  {
    id: "results",
    step: "2.",
    label: "Phiên & kết quả",
    icon: "M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z",
  },
  {
    id: "agents",
    step: "3.",
    label: "Agent",
    icon: "M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z",
  },
  {
    id: "diagnostics",
    step: "4.",
    label: "Chẩn đoán & bảo trì",
    icon: "M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z",
  },
] as const;

export function CrawlerWorkspace({
  section, onSectionChange, summary, crawl, results, agents, diagnostics,
}: CrawlerWorkspaceProps): React.JSX.Element {
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-slate-700 bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Distributed Crawler</h1>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">Thu thập sản phẩm Amazon, theo dõi agent và tự động gửi sang SEO Queue.</p>
            </div>
          </div>
          <button
            type="button"
            aria-expanded={isGuideOpen}
            onClick={() => setIsGuideOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 shadow-xs transition hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Hướng dẫn</span>
          </button>
        </div>
        {isGuideOpen ? (
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/50 p-3.5 text-xs leading-5 text-slate-700 dark:text-slate-300">
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Quy trình chuẩn:</strong> (1) Chọn store nhận sản phẩm và kiểm tra cấu hình Vendor / Profile cào / Xử lý ảnh → (2) Nhập danh sách ASIN hoặc lọc ASIN chưa có trên Shopify ở cột phải → (3) Thiết lập quy tắc cộng giá &amp; giảm giá Compare-At → (4) Bấm <strong>Bắt đầu cào</strong> để gửi job cho Agent và tự động chuyển sang SEO Queue.
          </div>
        ) : null}
        {summary}
        <nav aria-label="Khu vực crawler" className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-2.5">
          {WORKSPACE_SECTIONS.map((workspaceSection) => (
            <button
              key={workspaceSection.id}
              type="button"
              aria-label={workspaceSection.label}
              aria-controls={`crawler-panel-${workspaceSection.id}`}
              aria-pressed={section === workspaceSection.id}
              onClick={() => onSectionChange(workspaceSection.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 dark:focus-visible:outline-blue-400 ${section === workspaceSection.id ? "bg-blue-600 text-white shadow-xs" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
                <path d={workspaceSection.icon} />
              </svg>
              <span aria-hidden="true" className={section === workspaceSection.id ? "text-blue-100" : "text-slate-400 dark:text-slate-500"}>{workspaceSection.step}</span>
              <span>{workspaceSection.label}</span>
            </button>
          ))}
        </nav>
      </header>
      {/* Keep panels mounted: navigation must not discard configuration or audit drafts. */}
      <section id="crawler-panel-crawl" aria-label="Cào sản phẩm" hidden={section !== "crawl"} className="space-y-4">{crawl}</section>
      <section id="crawler-panel-results" aria-label="Phiên và kết quả" hidden={section !== "results"} className="space-y-4">{results}</section>
      <section id="crawler-panel-agents" aria-label="Quản lý Agent" hidden={section !== "agents"} className="space-y-4">{agents}</section>
      <section id="crawler-panel-diagnostics" aria-label="Chẩn đoán và bảo trì" hidden={section !== "diagnostics"} className="space-y-4">{diagnostics}</section>
    </div>
  );
}

