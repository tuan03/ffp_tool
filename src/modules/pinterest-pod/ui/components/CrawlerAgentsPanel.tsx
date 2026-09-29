import { useMemo, useState } from "react";

import type { CrawlerClientSummary } from "../../types";

interface CrawlerAgentsPanelProps {
  readonly agents: readonly CrawlerClientSummary[];
  readonly isLoading?: boolean;
  readonly onOpenInstall: () => void;
  readonly onForgetAgent?: (agent: CrawlerClientSummary) => Promise<void>;
}

function versionParts(value?: string): readonly number[] {
  if (!value) return [];
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  return parts.every(Number.isFinite) ? parts : [];
}

function hasNewerVersion(agent: CrawlerClientSummary): boolean {
  const current = versionParts(agent.agentVersion);
  const latest = versionParts(agent.latestAgentVersion);
  const length = Math.max(current.length, latest.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (latest[index] ?? 0) - (current[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function formatLastSeen(value?: string): string {
  if (!value) return "Chưa có dữ liệu";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("vi-VN");
}

function statusLabel(agent: CrawlerClientSummary): string {
  if (!agent.isConnected) return "Offline";
  if ((agent.activeTasks ?? 0) > 0) return "Đang cào";
  if (agent.status === "paused") return "Tạm dừng";
  if (agent.status === "waiting_captcha") return "Chờ CAPTCHA";
  return "Đang rảnh";
}

export function CrawlerAgentsPanel({
  agents,
  isLoading = false,
  onOpenInstall,
  onForgetAgent,
}: CrawlerAgentsPanelProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(true);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => Number(right.isConnected) - Number(left.isConnected)),
    [agents],
  );
  const connectedCount = agents.filter((agent) => agent.isConnected).length;
  const activeCount = agents.filter((agent) => agent.isConnected && (agent.activeTasks ?? 0) > 0).length;

  return (
    <section className="rounded-xl border border-slate-700/80 bg-slate-900/80 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="flex items-center gap-3 text-left"
        >
          <span className="text-lg">🖥️</span>
          <span>
            <span className="block text-sm font-bold text-slate-100">Máy Crawler Agent</span>
            <span className="block text-[11px] text-slate-400">
              {isLoading ? "Đang cập nhật..." : `${connectedCount} online · ${activeCount} đang cào · ${agents.length} máy đã đăng ký`}
            </span>
          </span>
          <span className="text-xs text-slate-500">{isExpanded ? "▼" : "▶"}</span>
        </button>
        <button
          type="button"
          onClick={onOpenInstall}
          className="rounded-lg border border-cyan-700/70 bg-cyan-950/50 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-900/60"
        >
          + Kết nối máy mới
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-800 p-4">
          {sortedAgents.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-400">
              Chưa có máy Agent nào kết nối.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {sortedAgents.map((agent) => {
                const pinterestLoginStatus = agent.capabilities?.pinterestBrowserLoggedIn;
                const isPinterestLoggedIn = pinterestLoginStatus === true;
                const hasPinterestLoginStatus = typeof pinterestLoginStatus === "boolean";
                const tasks = agent.currentTasks ?? [];
                const hasUpdate = hasNewerVersion(agent);
                return (
                  <article
                    key={agent.id}
                    className={`rounded-xl border p-3 ${agent.isConnected ? "border-emerald-800/60 bg-emerald-950/10" : "border-slate-800 bg-slate-950/40"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${agent.isConnected ? "bg-emerald-400" : "bg-slate-600"}`} />
                          <strong className="text-sm text-slate-100">{agent.displayName || agent.id}</strong>
                          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                            {statusLabel(agent)}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">
                          ID: {agent.id} · Phiên bản: {agent.agentVersion ?? "không rõ"}
                        </p>
                        {hasUpdate && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-amber-300">
                            <span>Có bản {agent.latestAgentVersion}.</span>
                            <button
                              type="button"
                              onClick={onOpenInstall}
                              className="rounded border border-amber-800/80 px-1.5 py-0.5 hover:bg-amber-950/60"
                            >
                              Cập nhật Agent
                            </button>
                          </div>
                        )}
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${isPinterestLoggedIn ? "bg-cyan-950 text-cyan-300" : "bg-amber-950 text-amber-300"}`}>
                        Pinterest: {isPinterestLoggedIn ? "Đã login" : hasPinterestLoginStatus ? "Chưa login" : "Chưa báo cáo"}
                      </span>
                    </div>

                    {tasks.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {tasks.map((task) => (
                          <div key={task.taskId} className="rounded-lg border border-indigo-900/60 bg-slate-950/70 p-2.5">
                            <div className="flex flex-wrap justify-between gap-2 text-[11px]">
                              <span className="font-semibold text-indigo-300">{task.channel === "pinterest" ? "Pinterest" : "Amazon"} · {task.stage ?? "crawl"}</span>
                              <span className="font-mono text-slate-500">{task.jobId || task.taskId}</span>
                            </div>
                            <p className="mt-1 text-xs font-semibold text-slate-200">
                              {task.niche || task.source || "Tác vụ crawler"}{task.product ? ` · ${task.product}` : ""}
                            </p>
                            <p className="mt-1 break-words text-[11px] leading-5 text-slate-400">{task.message || "Đang xử lý..."}</p>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                              <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(2, Math.min(100, task.percent ?? 0))}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-[11px] text-slate-500">
                        {agent.isConnected ? "Không có job đang chạy." : `Lần cuối kết nối: ${formatLastSeen(agent.lastSeenAt)}`}
                      </p>
                    )}
                    {!agent.isConnected && onForgetAgent && (
                      <div className="mt-3 border-t border-slate-800 pt-3 text-right">
                        <button
                          type="button"
                          disabled={busyAgentId === agent.id}
                          onClick={() => {
                            setBusyAgentId(agent.id);
                            void onForgetAgent(agent).finally(() => setBusyAgentId(null));
                          }}
                          className="rounded-lg border border-rose-900/70 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 hover:bg-rose-950/50 disabled:opacity-50"
                        >
                          {busyAgentId === agent.id ? "Đang quên..." : "Quên máy này"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
