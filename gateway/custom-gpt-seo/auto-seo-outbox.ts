import { fromAutoSeoProduct } from "../../src/modules/seo-content";
import type { AutoSeoSourceProduct } from "../../src/modules/seo-content";
import type { GptSeoSettings } from "../../src/modules/custom-gpt-seo";
import type { AutoSeoBackupRepository } from "../auto-seo-backup-repository";
import type { SeoQueue } from "./queue-contract";

/** Backup rows are the durable handoff outbox; enqueue precedes acknowledgment. */
export async function recoverAutoSeoHandoffs(repository: Pick<AutoSeoBackupRepository, "findPendingBackups" | "acknowledgePendingHandoff" | "failPendingHandoff">, queue: SeoQueue): Promise<void> {
  const rows = await repository.findPendingBackups(10);
  for (const row of rows) {
    try {
      const product = JSON.parse(row.snapshotJson) as AutoSeoSourceProduct;
      const input = fromAutoSeoProduct(product);
      (await queue.enqueue({ storeId: row.storeId, source: "auto_seo", sourceIdentity: String(input.productId || input.handle), input: { ...input, siteDomain: row.shopDomain }, original: product, settings: JSON.parse(String(row.gptSettingsJson)) as GptSeoSettings }));
      await repository.acknowledgePendingHandoff(row.backupId);
    } catch {
      await repository.failPendingHandoff(row.backupId, "Custom GPT handoff recovery failed; retry the backed-up workflow");
    }
  }
}
