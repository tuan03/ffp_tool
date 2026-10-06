import { finalizeExternalSeo, runSeoContentDetailed, registerSeoContentKeywords, SeoCorpusCommitCoordinator, FileSeoConflictCorpus } from "../../src/modules/seo-content";
import type { SeoContentDetailedResult } from "../../src/modules/seo-content";
import type { SeoQueue } from "./queue-contract";

export async function processCustomGptJob(queue: SeoQueue, finalize = finalizeExternalSeo): Promise<void> {
  for (const job of (await queue.pendingFinalization())) {
    try {
      let result: SeoContentDetailedResult;
      if (job.settings.provider === "gemini") {
        const prepared = await new SeoCorpusCommitCoordinator().prepare({
          corpusKey: new FileSeoConflictCorpus({ storeId: job.storeId }).getFilePath(),
          runSeo: () => runSeoContentDetailed(job.input, { imageMode: "alt_only", execution: job.execution }),
          register: execution => registerSeoContentKeywords(job.input, execution, { execution: job.execution }),
        });
        result = prepared.execution;
      } else {
        const externalResult = await finalize(job.input, job.checkpoints.analysis, job.checkpoints.keywords, job.checkpoints.submission, { execution: job.execution });
        result = {
          ...externalResult,
          metadata: { ...externalResult.metadata, engine: job.settings.provider },
        };
      }
      const original = job.execution.originalSnapshot && typeof job.execution.originalSnapshot === "object"
        ? job.execution.originalSnapshot as Record<string, unknown>
        : {};
      result = { ...result, output: { ...result.output, productHandle: typeof original.handle === "string" ? original.handle : "" } };
      (await queue.finish(job.storeId, job.id, result, job.finalizerToken));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Finalization failed";
      const name = error instanceof Error ? error.name : "";
      if (/RevisionConflict|LockTimeout/.test(name) || /SEO_QUEUE_STORAGE_UNAVAILABLE|SQLITE_BUSY|EBUSY|EMFILE/.test(message)) (await queue.retryFinalization(job.storeId, job.id, "Temporary storage contention; automatic retry scheduled", job.finalizerToken));
      else (await queue.failValidation(job.storeId, job.id, message, job.finalizerToken));
    }
  }
}
