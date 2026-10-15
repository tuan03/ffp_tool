import type { ReactNode } from "react";

import { PageHeader } from "../../../../shared/components/PageHeader";

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
    <div className="space-y-5">
      <header className="space-y-4">
        <PageHeader title="Distributed Crawler" description="Thu thập sản phẩm Amazon, theo dõi agent và bàn giao sang SEO Queue." />
        {summary}
        <nav aria-label="Khu vực crawler" className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
          {WORKSPACE_SECTIONS.map((workspaceSection) => (
            <button
              key={workspaceSection.id}
              type="button"
              aria-controls={`crawler-panel-${workspaceSection.id}`}
              aria-pressed={section === workspaceSection.id}
              onClick={() => onSectionChange(workspaceSection.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 ${section === workspaceSection.id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
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
