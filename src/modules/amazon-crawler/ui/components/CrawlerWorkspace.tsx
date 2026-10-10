import type { ReactNode } from "react";

export type CrawlerWorkspaceSection = "crawl" | "agents" | "diagnostics";

interface CrawlerWorkspaceProps {
  section: CrawlerWorkspaceSection;
  onSectionChange: (section: CrawlerWorkspaceSection) => void;
  summary: ReactNode;
  crawl: ReactNode;
  agents: ReactNode;
  diagnostics: ReactNode;
}

const WORKSPACE_SECTIONS = [
  { id: "crawl", label: "Cào sản phẩm" },
  { id: "agents", label: "Agent" },
  { id: "diagnostics", label: "Chẩn đoán & bảo trì" },
] as const;

export function CrawlerWorkspace({
  section, onSectionChange, summary, crawl, agents, diagnostics,
}: CrawlerWorkspaceProps): React.JSX.Element {
  return (
    <div className="mt-6 space-y-5">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Amazon Crawler</h1>
          <p className="mt-1 text-sm text-slate-400">Nhập link → cào sản phẩm → bàn giao SEO Queue. Xử lý ảnh tiếp tục theo profile đã chọn.</p>
        </div>
        {summary}
        <nav aria-label="Khu vực crawler" className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
          {WORKSPACE_SECTIONS.map((workspaceSection) => (
            <button
              key={workspaceSection.id}
              type="button"
              aria-controls={`crawler-panel-${workspaceSection.id}`}
              aria-pressed={section === workspaceSection.id}
              onClick={() => onSectionChange(workspaceSection.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${section === workspaceSection.id ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"}`}
            >{workspaceSection.label}</button>
          ))}
        </nav>
      </header>
      {/* Keep panels mounted: navigation must not discard configuration or audit drafts. */}
      <section id="crawler-panel-crawl" aria-label="Cào sản phẩm" hidden={section !== "crawl"} className="space-y-5">{crawl}</section>
      <section id="crawler-panel-agents" aria-label="Quản lý Agent" hidden={section !== "agents"} className="space-y-5">{agents}</section>
      <section id="crawler-panel-diagnostics" aria-label="Chẩn đoán và bảo trì" hidden={section !== "diagnostics"} className="space-y-5">{diagnostics}</section>
    </div>
  );
}
