import { createHash } from "node:crypto";

import type { GptSeoEnqueue, GptSeoJob } from "../../src/modules/custom-gpt-seo";
import { canonicalizeJson } from "../canonical-json";
import type { WorkerDatabase } from "./database";
import { SeoWorkerError } from "./protocol";

export interface RevisionRequest {
  readonly storeId: string;
  readonly jobId: string;
  readonly requestId: string;
  readonly operator: string;
  readonly instructions?: string;
}

function requestDigest(request: RevisionRequest): string {
  return createHash("sha256").update(canonicalizeJson({ jobId: request.jobId, instructions: request.instructions ?? null })).digest("hex");
}

/** Revisions preserve the old draft. They never release an uncertain Shopify write. */
export class SeoRevisionRepository {
  constructor(private readonly database: WorkerDatabase,
    private readonly enqueue: (input: GptSeoEnqueue, previousJobId: string) => Promise<GptSeoJob>,
    private readonly now: () => number = Date.now) {}

  async receipt(request: RevisionRequest): Promise<{ jobId: string; previousJobId: string } | null> {
    return this.database.transaction(async sql => {
      const previous = (await sql.query("SELECT * FROM seo_worker_revisions WHERE store_id=$1 AND request_id=$2", [request.storeId, request.requestId])).rows[0];
      if (!previous) return null;
      if (previous.digest !== requestDigest(request)) throw new SeoWorkerError("IDEMPOTENCY_CONFLICT");
      return { jobId: String(previous.job_id), previousJobId: String(previous.previous_job_id) };
    });
  }

  async create(request: RevisionRequest, parent: GptSeoJob, fresh: Pick<GptSeoEnqueue, "input" | "execution">): Promise<{ jobId: string; previousJobId: string }> {
    const digest = requestDigest(request);
    return this.database.transaction(async sql => {
      const previous = (await sql.query("SELECT * FROM seo_worker_revisions WHERE store_id=$1 AND request_id=$2", [request.storeId, request.requestId])).rows[0];
      if (previous) {
        if (previous.digest !== digest) throw new SeoWorkerError("IDEMPOTENCY_CONFLICT");
        return { jobId: String(previous.job_id), previousJobId: String(previous.previous_job_id) };
      }
      const stored = (await sql.query("SELECT payload FROM gpt_jobs WHERE id=$1 AND store_id=$2 FOR UPDATE", [request.jobId, request.storeId])).rows[0];
      if (!stored || parent.storeId !== request.storeId || parent.id !== request.jobId) throw new SeoWorkerError("JOB_NOT_FOUND");
      if (canonicalizeJson(JSON.parse(String(stored.payload))) !== canonicalizeJson(parent)) throw new SeoWorkerError("VERSION_CONFLICT");
      if (!(await sql.query("SELECT store_id FROM seo_worker_stores WHERE store_id=$1", [request.storeId])).rows.length) throw new SeoWorkerError("WORKER_MIGRATION_REQUIRED");
      if (!["REVIEW_READY", "NEEDS_CHANGES", "FAILED", "CANCELLED"].includes(parent.status)) throw new SeoWorkerError("REVISION_NOT_READY");
      if (parent.settings.provider !== "codex_mcp") throw new SeoWorkerError("REVISION_PROVIDER_UNSUPPORTED");
      if ((await sql.query("SELECT job_id FROM seo_worker_revisions WHERE previous_job_id=$1", [parent.id])).rows.length) throw new SeoWorkerError("REVISION_ALREADY_EXISTS");
      const worker = (await sql.query("SELECT lease_id FROM seo_worker_jobs WHERE job_id=$1 FOR UPDATE", [parent.id])).rows[0];
      if (worker?.lease_id) throw new SeoWorkerError("REVISION_NOT_READY");
      const publish = (await sql.query("SELECT * FROM seo_publish_operations WHERE job_id=$1 FOR UPDATE", [parent.id])).rows[0];
      if (publish && publish.state !== "SUCCEEDED" && !(publish.state === "BLOCKED" && publish.has_write_intent === false)) throw new SeoWorkerError("PUBLISH_UNRESOLVED");
      if (!publish && (await sql.query("SELECT job_id FROM gpt_sync WHERE job_id=$1 AND status IN ('SYNCING','UNKNOWN')", [parent.id])).rows.length) throw new SeoWorkerError("PUBLISH_UNRESOLVED");
      await sql.query("UPDATE seo_worker_jobs SET pipeline_active=false,state='CLOSED',updated_at=$2 WHERE job_id=$1", [parent.id, this.now()]);
      const next = await this.enqueue({ ...fresh, settings: parent.settings }, parent.id);
      if (publish?.state === "BLOCKED") await sql.query("UPDATE seo_publish_operations SET superseded_by=$2 WHERE id=$1", [publish.id, next.id]);
      await sql.query("INSERT INTO seo_worker_revisions(store_id,request_id,digest,previous_job_id,job_id,operator,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [request.storeId, request.requestId, digest, parent.id, next.id, request.operator, this.now()]);
      await sql.query("INSERT INTO gpt_audit(store_id,job_id,event,created_at) VALUES ($1,$2,$3,$4)", [request.storeId, next.id, `REVISION_CREATED:${parent.id}:${request.operator}`, this.now()]);
      return { jobId: next.id, previousJobId: parent.id };
    });
  }
}
