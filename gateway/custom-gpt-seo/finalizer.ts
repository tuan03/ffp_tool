import { finalizeExternalSeo, runSeoContentDetailed, registerSeoContentKeywords, SeoCorpusCommitCoordinator, FileSeoConflictCorpus } from "../../src/modules/seo-content";
import type { SeoContentDetailedOutput } from "../../src/modules/seo-content";
import type { CustomGptQueue } from "./queue";

export async function processCustomGptJob(queue: CustomGptQueue, finalize = finalizeExternalSeo): Promise<void> {
  for (const job of queue.pendingFinalization()) {
    try {
      const input = { ...job.input, storeId: job.storeId };
      let result: SeoContentDetailedOutput;
      if (job.settings.provider === "gemini") {
        const prepared = await new SeoCorpusCommitCoordinator().prepare({
          corpusKey: new FileSeoConflictCorpus({ storeId: job.storeId }).getFilePath(),
          runSeo: () => runSeoContentDetailed(input, { imageMode: "alt_only" }),
          register: execution => registerSeoContentKeywords(input, execution),
        });
        result = { ...prepared.execution, output: { ...prepared.execution.output, images: prepared.execution.output.images.map((image, index) => ({ ...image, webp: { url: image.sourceUrl, filename: `${job.input.handle || "product"}-${index + 1}.webp` } })) } };
      } else {
        result = await finalize(input, job.checkpoints.analysis, job.checkpoints.keywords, job.checkpoints.submission);
      }
      queue.finish(job.storeId, job.id, result, job.finalizerToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Finalization failed";
      const name = error instanceof Error ? error.name : "";
      if (/RevisionConflict|LockTimeout/.test(name) || /SQLITE_BUSY|EBUSY|EMFILE/.test(message)) queue.retryFinalization(job.storeId, job.id, "Temporary storage contention; automatic retry scheduled", job.finalizerToken);
      else queue.failValidation(job.storeId, job.id, message, job.finalizerToken);
    }
  }
}
