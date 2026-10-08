import { fromAutoSeoProduct } from "../../src/modules/seo-content";
import type { AutoSeoSourceProduct } from "../../src/modules/seo-content";
import type { GptSeoSettings } from "../../src/modules/custom-gpt-seo";
import type { AutoSeoBackupRepository } from "../auto-seo-backup-repository";
import type { SeoQueue } from "./queue-contract";
import { SEO_WORKER_SCHEMA_VERSION } from "./input-contract";
import { AutoSeoStoreProfileError, requireAutoSeoStoreProfile } from "../seo-content/store-profile";

/** Backup rows are the durable handoff outbox; enqueue precedes acknowledgment. */
export async function recoverAutoSeoHandoffs(repository: Pick<AutoSeoBackupRepository, "findPendingBackups" | "acknowledgePendingHandoff" | "failPendingHandoff">, queue: SeoQueue, resolveProfile = requireAutoSeoStoreProfile): Promise<void> {
  const rows = await repository.findPendingBackups(10);
  for (const row of rows) {
    try {
      const product = JSON.parse(row.snapshotJson) as AutoSeoSourceProduct;
      const storeProfile = resolveProfile({ storeId: row.storeId, shopDomain: row.shopDomain });
      const input = fromAutoSeoProduct(product, storeProfile.niche, storeProfile);
      const settings = JSON.parse(String(row.gptSettingsJson)) as GptSeoSettings;
      (await queue.enqueue({ input, execution: { storeId: row.storeId, productId: row.productId, source: "auto_seo",
        sourceIdentity: row.productId, sourceRevision: row.snapshotSha256, shopifyUpdatedAt: row.shopifyUpdatedAt ?? undefined,
        providerId: settings.provider, pipelineVersion: SEO_WORKER_SCHEMA_VERSION, originalSnapshot: product }, settings }));
      await repository.acknowledgePendingHandoff(row.backupId);
    } catch (error: unknown) {
      await repository.failPendingHandoff(row.backupId, error instanceof AutoSeoStoreProfileError
        ? `${error.code}: ${error.message}`
        : "Custom GPT handoff recovery failed; retry the backed-up workflow");
    }
  }
}
