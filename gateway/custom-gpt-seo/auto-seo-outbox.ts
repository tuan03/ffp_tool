import { fromAutoSeoProduct } from "../../src/modules/seo-content";
import type { AutoSeoSourceProduct } from "../../src/modules/seo-content";
import type { GptSeoSettings } from "../../src/modules/custom-gpt-seo";
import type { AutoSeoBackupRepository } from "../auto-seo-backup-repository";
import type { CustomGptQueue } from "./queue";

/** Backup rows are the durable handoff outbox; enqueue precedes acknowledgment. */
export async function recoverAutoSeoHandoffs(repository: Pick<AutoSeoBackupRepository, "findPendingBackups" | "acknowledgePendingHandoff" | "failPendingHandoff">, queue: CustomGptQueue): Promise<void> {
  const rows = await repository.findPendingBackups(10);
  for (const row of rows) {
    try {
      const product = JSON.parse(row.snapshotJson) as AutoSeoSourceProduct;
      const input = fromAutoSeoProduct(product);
      queue.enqueue({ storeId: row.storeId, source: "auto_seo", sourceIdentity: String(input.productId || input.handle), input: { ...input, siteDomain: row.shopDomain }, original: product, settings: JSON.parse(String(row.gptSettingsJson)) as GptSeoSettings });
      await repository.acknowledgePendingHandoff(row.backupId);
    } catch {
      await repository.failPendingHandoff(row.backupId, "Custom GPT handoff recovery failed; retry the backed-up workflow");
    }
  }
}
