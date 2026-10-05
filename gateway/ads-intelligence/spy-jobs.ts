import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod/v4";

import { competitorResearchSchema, readCompetitorResearch, publishCompetitorResearch } from "./competitor-research";
import type { CompetitorResearch } from "./competitor-research";
import { getAdsGatewayStore } from "./gateway-connection";
import { detectSpyRunners, executeSpy } from "./spy-runner";
import { appendSpyEvent, readSpyEvents } from "./spy-events";
import type { SpyEvent } from "./spy-events";

export const spyStartSchema = z.object({ storeId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/), runner: z.enum(["codex", "agy"]), model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/) });
export interface SpyRunner { id: "codex" | "agy"; name: string; available: boolean; models: readonly string[]; defaultModel: string }
export interface SpyCapabilities { runners: readonly SpyRunner[]; skillAvailable?: boolean }
export interface SpyJob {
  id: string; storeId: string; shopDomain: string; runner: "codex" | "agy"; model: string;
  status: "running" | "completed" | "partial" | "failed" | "cancelled" | "interrupted";
  startedAt: string; finishedAt?: string; phase: string; errorCode?: string;
  events?: SpyEvent[];
  published?: boolean; selectedCount?: number; adCount?: number; brandsWithAds?: number;
}
export interface SpyExecution { job: SpyJob; directory: string; signal: AbortSignal }
interface Dependencies {
  root: string;
  resolveStore(storeId: string): Promise<{ storeId: string; shopDomain: string }>;
  capabilities(): Promise<SpyCapabilities>;
  execute(input: SpyExecution): Promise<void>;
  publish(research: CompetitorResearch): Promise<unknown>;
  readResearch(storeId: string): Promise<CompetitorResearch | null>;
}

export async function writeSpyJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

export function createSpyJobs(dependencies: Dependencies) {
  const active = new Map<string, { job: SpyJob; controller: AbortController; promise: Promise<void> }>();
  const locks = new Map<string, Promise<unknown>>();
  const storePath = (storeId: string) => join(dependencies.root, `${spyStartSchema.shape.storeId.parse(storeId)}.json`);
  const locked = async <T>(storeId: string, operation: () => Promise<T>): Promise<T> => {
    const next = (locks.get(storeId) ?? Promise.resolve()).then(operation);
    locks.set(storeId, next.catch(() => undefined));
    return next;
  };
  const save = async (job: SpyJob) => { await mkdir(dependencies.root, { recursive: true }); await writeSpyJson(storePath(job.storeId), job); };
  const get = async (storeId: string): Promise<SpyJob | null> => {
    await dependencies.resolveStore(storeId);
    let job: SpyJob;
    try { job = JSON.parse(await readFile(storePath(storeId), "utf8")) as SpyJob; }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
    if (job.storeId !== storeId) throw new Error("SPY_JOB_NOT_FOUND");
    if (job.status === "running" && !active.has(storeId)) {
      job = { ...job, status: "interrupted", errorCode: "SPY_SERVER_RESTARTED", finishedAt: new Date().toISOString() };
      await save(job);
    }
    {
      try {
        const progress: unknown = JSON.parse(await readFile(join(dependencies.root, job.id, "progress.json"), "utf8"));
        const parsed = z.object({ phase: z.enum(["profile", "discovery", "ads", "media", "analysis", "publish"]) }).safeParse(progress);
        if (parsed.success) job.phase = parsed.data.phase;
      } catch { /* Progress may not exist until the first tool call. */ }
    }
    job.events = await readSpyEvents(join(dependencies.root, job.id));
    return job;
  };
  return {
    get: (storeId: string) => locked(storeId, () => get(storeId)),
    async start(input: unknown): Promise<SpyJob> {
      const request = spyStartSchema.parse(input);
      return locked(request.storeId, async () => {
        if (active.has(request.storeId)) throw new Error("SPY_ALREADY_RUNNING");
        const store = await dependencies.resolveStore(request.storeId);
        const capabilities = await dependencies.capabilities();
        if (capabilities.skillAvailable === false) throw new Error("SPY_SKILL_MISSING");
        const runner = capabilities.runners.find(candidate => candidate.id === request.runner);
        if (!runner?.available) throw new Error("SPY_RUNNER_UNAVAILABLE");
        if (!runner.models.includes(request.model)) throw new Error("SPY_MODEL_UNAVAILABLE");
        const job: SpyJob = { ...request, id: randomUUID(), shopDomain: store.shopDomain, status: "running", startedAt: new Date().toISOString(), phase: "profile" };
        const directory = join(dependencies.root, job.id);
        await mkdir(directory, { recursive: true });
        await writeSpyJson(join(directory, "request.json"), job);
        await appendSpyEvent(directory, { level: "info", message: "Đã tiếp nhận lượt Spy. Đang khởi động CLI cho store đã chọn." });
        const controller = new AbortController();
        const entry = { job, controller, promise: Promise.resolve() };
        active.set(job.storeId, entry);
        await save(job);
        entry.promise = (async () => {
          try {
            await dependencies.execute({ job, directory, signal: controller.signal });
            await locked(job.storeId, async () => {
              if (controller.signal.aborted) return;
              await appendSpyEvent(directory, { level: "info", message: "CLI đã kết thúc. Backend đang kiểm tra kết quả trước khi công bố." });
              let candidateText: string;
              try { candidateText = await readFile(join(directory, "candidate.json"), "utf8"); }
              catch (error) {
                if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error("SPY_RESEARCH_MISSING", { cause: error });
                throw error;
              }
              const report = competitorResearchSchema.parse(JSON.parse(candidateText));
              if (report.storeId !== job.storeId || report.shopDomain !== job.shopDomain || Date.parse(report.observedAt) < Date.parse(job.startedAt)) throw new Error("SPY_RESEARCH_INVALID");
              if (!report.selected.length || !report.adCollection || report.adCollection.length !== report.selected.length || new Set(report.adCollection.map(c => c.brandDomain)).size !== report.selected.length || report.selected.some(c => !report.adCollection?.some(row => row.brandDomain === c.domain))) throw new Error("SPY_COVERAGE_INCOMPLETE");
              if (report.verifiedAds?.some(entry => entry.ad.inspectionLevel === "TEXT_ONLY" || entry.ad.inspectionLevel === "THUMBNAIL_ONLY")) throw new Error("SPY_MEDIA_UNVERIFIED");
              const previous = await dependencies.readResearch(job.storeId);
              const adCount = report.verifiedAds?.length ?? 0;
              // A failed/empty refresh must not erase the last useful ad library.
              const shouldPublish = adCount > 0 || !(previous?.verifiedAds?.length);
              if (shouldPublish) await dependencies.publish(report);
              const brandsWithAds = new Set(report.verifiedAds?.map(ad => ad.brandDomain)).size;
              Object.assign(job, { status: report.selected.length === 10 && brandsWithAds === 10 ? "completed" : "partial", published: shouldPublish, selectedCount: report.selected.length, adCount, brandsWithAds, phase: "publish", finishedAt: new Date().toISOString() });
              await appendSpyEvent(directory, { level: "success", message: shouldPublish ? `Đã lưu ${adCount} quảng cáo của ${brandsWithAds} thương hiệu; ${report.selected.length} đối thủ được chọn.` : "Lượt mới chưa có quảng cáo xác minh; giữ nguyên thư viện cũ." });
              await save(job);
            });
          } catch (error) {
            await locked(job.storeId, async () => {
              if (controller.signal.aborted) return;
              const code = error instanceof Error && /^SPY_[A-Z_]+$/.test(error.message) ? error.message : "SPY_EXECUTION_FAILED";
              await appendSpyEvent(directory, { level: "error", message: `Lượt Spy dừng: ${code}. Không công bố kết quả mới.` });
              Object.assign(job, { status: "failed", errorCode: code, finishedAt: new Date().toISOString() });
              await save(job);
            });
          } finally { if (active.get(job.storeId) === entry) active.delete(job.storeId); }
        })();
        return { ...job };
      });
    },
    async cancel(storeId: string, jobId: string): Promise<SpyJob> {
      return locked(storeId, async () => {
        const job = await get(storeId);
        if (!job || job.id !== jobId) throw new Error("SPY_JOB_NOT_FOUND");
        if (job.status !== "running") return job;
        const entry = active.get(storeId);
        entry?.controller.abort();
        const cancelled: SpyJob = { ...job, status: "cancelled", finishedAt: new Date().toISOString() };
        await appendSpyEvent(join(dependencies.root, job.id), { level: "info", message: "Đã nhận yêu cầu dừng từ người dùng; không công bố kết quả lượt này." });
        await save(cancelled);
        return cancelled;
      });
    },
    async settled(storeId: string): Promise<void> { await active.get(storeId)?.promise; },
  };
}

export const spyJobs = createSpyJobs({ root: resolve(".runtime/ads-intelligence/spy-jobs"), resolveStore: getAdsGatewayStore, capabilities: detectSpyRunners, execute: executeSpy, publish: publishCompetitorResearch, readResearch: readCompetitorResearch });
