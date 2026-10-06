import type { GptJobStatus, GptSeoJob, SeoProvider } from "../types";

export type QueueStatusGroup = "all" | "waiting" | "processing" | "attention" | "ready" | "cancelled";
export type QueueProviderFilter = "all" | SeoProvider;

export interface ProviderPresentation {
  readonly label: string;
  readonly description: string;
}

export interface StatusPresentation {
  readonly label: string;
  readonly badgeClassName: string;
  readonly dotClassName: string;
}

export interface QueueSummary {
  readonly key: Exclude<QueueStatusGroup, "all">;
  readonly label: string;
  readonly description: string;
  readonly count: number;
  readonly accentClassName: string;
}

export interface QueueFilters {
  readonly query: string;
  readonly group: QueueStatusGroup;
  readonly provider: QueueProviderFilter;
}

const PROVIDER_PRESENTATIONS: Record<SeoProvider, ProviderPresentation> = {
  gemini: { label: "Gemini", description: "Xử lý tự động qua API" },
  custom_gpt: { label: "GPT Custom", description: "Xử lý thủ công qua GPT" },
  codex_mcp: { label: "Codex MCP", description: "Xử lý thủ công qua MCP" },
};

const STATUS_PRESENTATIONS: Record<GptJobStatus, StatusPresentation> = {
  PENDING: {
    label: "Chờ xử lý",
    badgeClassName: "border-slate-600 bg-slate-800 text-slate-200",
    dotClassName: "bg-slate-400",
  },
  IN_PROGRESS: {
    label: "Đang xử lý",
    badgeClassName: "border-cyan-800 bg-cyan-950/70 text-cyan-200",
    dotClassName: "bg-cyan-400",
  },
  WAITING_INPUT: {
    label: "Cần bổ sung",
    badgeClassName: "border-amber-800 bg-amber-950/70 text-amber-200",
    dotClassName: "bg-amber-400",
  },
  VALIDATING: {
    label: "Đang kiểm tra",
    badgeClassName: "border-blue-800 bg-blue-950/70 text-blue-200",
    dotClassName: "bg-blue-400",
  },
  NEEDS_CHANGES: {
    label: "Cần chỉnh sửa",
    badgeClassName: "border-orange-800 bg-orange-950/70 text-orange-200",
    dotClassName: "bg-orange-400",
  },
  REVIEW_READY: {
    label: "Sẵn sàng duyệt",
    badgeClassName: "border-emerald-800 bg-emerald-950/70 text-emerald-200",
    dotClassName: "bg-emerald-400",
  },
  FAILED: {
    label: "Lỗi xử lý",
    badgeClassName: "border-rose-800 bg-rose-950/70 text-rose-200",
    dotClassName: "bg-rose-400",
  },
  CANCELLED: {
    label: "Đã hủy",
    badgeClassName: "border-slate-700 bg-slate-900 text-slate-400",
    dotClassName: "bg-slate-600",
  },
};

const GROUP_STATUSES: Record<Exclude<QueueStatusGroup, "all">, readonly GptJobStatus[]> = {
  waiting: ["PENDING"],
  processing: ["IN_PROGRESS", "VALIDATING"],
  attention: ["WAITING_INPUT", "NEEDS_CHANGES", "FAILED"],
  ready: ["REVIEW_READY"],
  cancelled: ["CANCELLED"],
};

export function getStatusesForGroup(group: QueueStatusGroup): readonly GptJobStatus[] | undefined {
  return group === "all" ? undefined : GROUP_STATUSES[group];
}

const SUMMARY_DEFINITIONS: readonly Omit<QueueSummary, "count">[] = [
  {
    key: "waiting",
    label: "Chờ xử lý",
    description: "Đang đợi AI nhận việc",
    accentClassName: "text-slate-100",
  },
  {
    key: "processing",
    label: "Đang xử lý",
    description: "AI đang phân tích và viết",
    accentClassName: "text-cyan-300",
  },
  {
    key: "attention",
    label: "Cần xử lý",
    description: "Cần bổ sung, sửa hoặc thử lại",
    accentClassName: "text-amber-300",
  },
  {
    key: "ready",
    label: "Sẵn sàng duyệt",
    description: "Có thể mở SEO Review",
    accentClassName: "text-emerald-300",
  },
  {
    key: "cancelled",
    label: "Đã hủy",
    description: "Không còn trong luồng xử lý",
    accentClassName: "text-slate-500",
  },
];

export function getProviderPresentation(provider: string): ProviderPresentation {
  if (provider in PROVIDER_PRESENTATIONS) return PROVIDER_PRESENTATIONS[provider as SeoProvider];
  return {
    label: provider.replaceAll("_", " "),
    description: "AI xử lý chưa xác định",
  };
}

export function getBatchOwnerLabel(ownerId: string): string {
  if (ownerId === "custom_gpt") return "GPT Custom";
  if (ownerId === "codex_mcp:default") return "Máy mặc định";
  if (ownerId.startsWith("codex_mcp:")) return ownerId.slice("codex_mcp:".length);
  return ownerId.replaceAll("_", " ");
}

export function getStatusPresentation(status: string): StatusPresentation {
  if (status in STATUS_PRESENTATIONS) return STATUS_PRESENTATIONS[status as GptJobStatus];
  return {
    label: status.replaceAll("_", " "),
    badgeClassName: "border-slate-700 bg-slate-900 text-slate-300",
    dotClassName: "bg-slate-500",
  };
}

export function getStatusGroup(status: GptJobStatus): Exclude<QueueStatusGroup, "all"> {
  if (status === "PENDING") return "waiting";
  if (status === "IN_PROGRESS" || status === "VALIDATING") return "processing";
  if (status === "WAITING_INPUT" || status === "NEEDS_CHANGES" || status === "FAILED") return "attention";
  if (status === "REVIEW_READY") return "ready";
  return "cancelled";
}

export function buildQueueSummaries(
  jobs: readonly GptSeoJob[],
  counts?: Readonly<Record<string, number>>,
): readonly QueueSummary[] {
  return SUMMARY_DEFINITIONS.map(definition => ({
    ...definition,
    count: counts
      ? GROUP_STATUSES[definition.key].reduce((total, status) => total + (counts[status] ?? 0), 0)
      : jobs.filter(job => getStatusGroup(job.status) === definition.key).length,
  }));
}

export function getJobProgress(job: GptSeoJob): { readonly completed: number; readonly total: number } {
  const total = 4;
  if (job.status === "REVIEW_READY") return { completed: total, total };
  return { completed: Math.min(Object.keys(job.checkpoints).length, total), total };
}

export function canRetryJob(job: GptSeoJob): boolean {
  return job.status === "FAILED" || job.status === "WAITING_INPUT" || job.status === "NEEDS_CHANGES";
}

function readSourceString(job: GptSeoJob, keys: readonly string[]): string | undefined {
  if (!job.original || typeof job.original !== "object" || Array.isArray(job.original)) return undefined;
  const source = job.original as Readonly<Record<string, unknown>>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function getJobSourceTitle(job: GptSeoJob): string {
  return readSourceString(job, ["title", "sourceTitle"]) ?? `Product ${job.sourceIdentity}`;
}

export function getJobSourceHandle(job: GptSeoJob): string | undefined {
  return readSourceString(job, ["handle"]);
}

export function filterQueueJobs(jobs: readonly GptSeoJob[], filters: QueueFilters): readonly GptSeoJob[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();
  return jobs.filter(job => {
    if (filters.group !== "all" && getStatusGroup(job.status) !== filters.group) return false;
    if (filters.provider !== "all" && job.settings.provider !== filters.provider) return false;
    if (!normalizedQuery) return true;

    const searchableText = [
      job.id,
      getJobSourceTitle(job),
      getJobSourceHandle(job),
      job.source,
      getProviderPresentation(job.settings.provider).label,
      job.settings.provider,
    ].join(" ").toLocaleLowerCase();
    return searchableText.includes(normalizedQuery);
  });
}
