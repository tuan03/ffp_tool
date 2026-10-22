import { randomUUID } from "node:crypto";

import type { GenerateReviewInput } from "./amazon-reviews-generator";
import type { ReviewTextJob, ReviewTextPhase, ReviewTextRepository, ReviewTextResult, ReviewTextStatus } from "./review-text-repository";

interface ReviewTextDependencies {
  readContext(contextJobId: string): Promise<GenerateReviewInput>;
  checkBridge(): Promise<void>;
  generate(input: GenerateReviewInput, id: string, signal: AbortSignal, progress: (status: ReviewTextStatus, phase?: ReviewTextPhase) => Promise<void>): Promise<ReviewTextResult>;
  save(contextJobId: string, result: ReviewTextResult): Promise<void>;
  cancelBridge(id: string): Promise<void>;
}
export class ReviewTextJobs {
  private readonly tasks = new Map<string, { promise: Promise<void>; controller: AbortController; job: ReviewTextJob }>();
  constructor(private readonly repository: ReviewTextRepository, private readonly dependencies: ReviewTextDependencies) {}
  async create(input: { contextJobId: string; storeId: string; count: number; requestId: string }): Promise<ReviewTextJob> {
    // Replay and active-job lookup happen before checking connectivity.
    const prior = await this.repository.byRequest(input.requestId);
    if (prior) {
      if (prior.count !== input.count || prior.contextJobId !== input.contextJobId || prior.storeId !== input.storeId) throw new Error("REVIEW_REQUEST_CONFLICT");
      return prior;
    }
    const latest = await this.repository.latest(input.contextJobId, input.storeId);
    if (latest && ["queued", "running", "validating", "saving", "save_failed"].includes(latest.status)) return latest;
    await this.dependencies.checkBridge();
    const context = await this.dependencies.readContext(input.contextJobId);
    if (context.priorSamples.length + input.count > 500) throw new Error("REVIEW_SAMPLE_LIMIT");
    const now = new Date().toISOString();
    const job: ReviewTextJob = { ...input, id: randomUUID(), status: "queued", createdAt: now, updatedAt: now,
      input: { ...context, count: input.count } };
    const stored = await this.repository.insert(job);
    if (stored.contextJobId !== input.contextJobId || stored.storeId !== input.storeId || stored.requestId === input.requestId && stored.count !== input.count) throw new Error("REVIEW_REQUEST_CONFLICT");
    if (stored.id === job.id) this.launch(job, false);
    return stored;
  }
  get(id: string): Promise<ReviewTextJob | null> { return this.repository.get(id); }
  latest(contextJobId: string, storeId: string): Promise<ReviewTextJob | null> { return this.repository.latest(contextJobId, storeId); }
  async wait(id: string): Promise<void> { await this.tasks.get(id)?.promise; }
  private launch(job: ReviewTextJob, saveOnly: boolean): void {
    if (this.tasks.has(job.id)) return;
    const controller = new AbortController();
    const promise = this.run(job, controller.signal, saveOnly).finally(() => this.tasks.delete(job.id));
    // Persistence failures are logged without exposing generated content or credentials.
    void promise.catch(() => console.error("[Review text] Background job persistence failed; inspect job status."));
    this.tasks.set(job.id, { promise, controller, job });
  }
  private async run(job: ReviewTextJob, signal: AbortSignal, saveOnly: boolean): Promise<void> {
    const progress = async (status: ReviewTextStatus, phase?: ReviewTextPhase): Promise<void> => {
      signal.throwIfAborted(); job.status = status; job.phase = phase; job.updatedAt = new Date().toISOString(); await this.repository.update(job);
    };
    try {
      if (!saveOnly) {
        job.input = { ...await this.dependencies.readContext(job.contextJobId), count: job.count };
        if (job.input.priorSamples.length + job.count > 500) throw new Error("REVIEW_SAMPLE_LIMIT");
        job.result = await this.dependencies.generate(job.input, job.id, signal, progress);
      }
      signal.throwIfAborted();
      if (!job.result?.samples.length) {
        job.error = "ChatGPT chưa trả về mẫu đạt yêu cầu. Không có review nào được lưu.";
        await progress("failed"); return;
      }
      // Persist the accepted response before crossing the Coordinator boundary.
      await progress("saving");
      await this.dependencies.readContext(job.contextJobId);
      await this.dependencies.save(job.contextJobId, job.result);
      job.error = undefined;
      await progress(job.result.rejected ? "partial" : "completed");
    } catch (error) {
      job.status = signal.aborted ? "cancelled" : job.result?.samples.length ? "save_failed" : "failed";
      job.error = signal.aborted ? "Đã hủy tác vụ. Không gửi lại prompt." : job.status === "save_failed"
        ? "Đã tạo được review nhưng chưa lưu được. Bấm Thử lưu lại; không cần tạo lại bằng ChatGPT."
        : error instanceof Error && error.message.startsWith("REVIEW_") ? error.message
          : "ChatGPT Bridge bị gián đoạn hoặc phản hồi không hợp lệ. Kiểm tra tab ChatGPT trước khi thử lại.";
      job.updatedAt = new Date().toISOString(); await this.repository.update(job);
    }
  }
  async retrySave(id: string): Promise<ReviewTextJob> {
    const job = await this.repository.get(id);
    if (!job || job.status !== "save_failed") throw new Error("REVIEW_NOT_RETRYABLE");
    this.launch(job, true); return job;
  }
  async cancel(id: string): Promise<ReviewTextJob> {
    const job = await this.repository.get(id);
    if (!job) throw new Error("REVIEW_JOB_NOT_FOUND");
    const currentStatus = this.tasks.get(id)?.job.status ?? job.status;
    if (currentStatus === "saving") throw new Error("REVIEW_SAVE_IN_PROGRESS");
    if (["completed", "partial", "failed", "cancelled", "interrupted"].includes(currentStatus)) return await this.repository.get(id) ?? job;
    if (!["queued", "running", "validating", "save_failed"].includes(job.status)) return job;
    this.tasks.get(id)?.controller.abort();
    await this.dependencies.cancelBridge(id);
    await this.tasks.get(id)?.promise;
    job.status = "cancelled"; job.error = "Đã hủy tác vụ."; job.updatedAt = new Date().toISOString();
    await this.repository.update(job); return job;
  }
  async close(): Promise<void> {
    for (const [id, task] of this.tasks) {
      if (task.job.status === "saving") continue;
      task.controller.abort(); await this.dependencies.cancelBridge(id).catch(() => {});
    }
    await Promise.allSettled([...this.tasks.values()].map(task => task.promise));
    await this.repository.close();
  }
}
