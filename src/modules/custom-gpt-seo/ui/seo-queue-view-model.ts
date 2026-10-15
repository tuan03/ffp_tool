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
    badgeClassName: "border-slate-300 bg-slate-50 text-slate-900",
    dotClassName: "bg-slate-200",
  },
  IN_PROGRESS: {
    label: "Đang xử lý",
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    dotClassName: "bg-blue-600",
  },
  WAITING_INPUT: {
    label: "Cần xử lý",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    dotClassName: "bg-amber-700",
  },
  VALIDATING: {
    label: "Đang kiểm tra",
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    dotClassName: "bg-blue-600",
  },
  NEEDS_CHANGES: {
    label: "Cần chỉnh sửa",
    badgeClassName: "border-orange-200 bg-orange-50 text-orange-700",
    dotClassName: "bg-orange-700",
  },
  REVIEW_READY: {
    label: "Sẵn sàng duyệt",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dotClassName: "bg-emerald-700",
  },
  FAILED: {
    label: "Lỗi xử lý",
    badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
    dotClassName: "bg-rose-600",
  },
  CANCELLED: {
    label: "Đã hủy",
    badgeClassName: "border-slate-300 bg-white text-slate-600",
    dotClassName: "bg-slate-100",
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
    accentClassName: "text-slate-900",
  },
  {
    key: "processing",
    label: "Đang xử lý",
    description: "AI đang phân tích và viết",
    accentClassName: "text-blue-700",
  },
  {
    key: "attention",
    label: "Cần xử lý",
    description: "Cần bổ sung, sửa hoặc thử lại",
    accentClassName: "text-amber-700",
  },
  {
    key: "ready",
    label: "Sẵn sàng duyệt",
    description: "Có thể mở SEO Review",
    accentClassName: "text-emerald-700",
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
    badgeClassName: "border-slate-300 bg-white text-slate-700",
    dotClassName: "bg-slate-200",
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
