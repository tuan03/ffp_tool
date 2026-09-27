import type { DatabaseSync } from "node:sqlite";
import { fromAutoSeoProduct } from "../../src/modules/seo-content";
import type { AutoSeoSourceProduct } from "../../src/modules/seo-content";
import type { GptSeoSettings } from "../../src/modules/custom-gpt-seo";
import type { CustomGptQueue } from "./queue";

/** Backup rows are the durable handoff outbox; enqueue precedes acknowledgment. */
export function recoverAutoSeoHandoffs(db: DatabaseSync, queue: CustomGptQueue): void {
  const rows = db.prepare("SELECT * FROM auto_seo_product_backups WHERE downstream_status='NOT_SENT' AND gpt_settings_json IS NOT NULL ORDER BY created_at LIMIT 10").all();
  for (const row of rows) {
    try {
      const product = JSON.parse(String(row.snapshot_json)) as AutoSeoSourceProduct;
      const input = fromAutoSeoProduct(product);
      queue.enqueue({ storeId: String(row.store_id), source: "auto_seo", sourceIdentity: String(input.productId || input.handle), input: { ...input, siteDomain: String(row.shop_domain) }, original: product, settings: JSON.parse(String(row.gpt_settings_json)) as GptSeoSettings });
      db.prepare("UPDATE auto_seo_product_backups SET downstream_status='SENT',downstream_sent_at=? WHERE backup_id=? AND downstream_status='NOT_SENT'").run(new Date().toISOString(), String(row.backup_id));
    } catch {
      db.prepare("UPDATE auto_seo_product_backups SET downstream_status='FAILED',downstream_error=? WHERE backup_id=?").run("Custom GPT handoff recovery failed; retry the backed-up workflow", String(row.backup_id));
    }
  }
}
