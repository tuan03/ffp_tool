/** Durable, compact identities shared with the Python Coordinator. Never scan snapshots on a handoff. */
export function getSeoPipelineIdentitySchemaSql(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid SEO pipeline schema");
  const prefix = `"${schema}".`;
  return `
    CREATE TABLE IF NOT EXISTS ${prefix}seo_pipeline_identities (
      job_id TEXT PRIMARY KEY REFERENCES ${prefix}gpt_jobs(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL, source_key TEXT NOT NULL, source_revision TEXT NOT NULL,
      owner_item_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seo_pipeline_owner ON ${prefix}seo_pipeline_identities(store_id,owner_item_id);
    CREATE TABLE IF NOT EXISTS ${prefix}seo_pipeline_asins (
      store_id TEXT NOT NULL, asin TEXT NOT NULL, job_id TEXT NOT NULL
        REFERENCES ${prefix}seo_pipeline_identities(job_id) ON DELETE CASCADE,
      PRIMARY KEY(store_id,asin,job_id)
    );
    CREATE INDEX IF NOT EXISTS seo_pipeline_asin_job ON ${prefix}seo_pipeline_asins(job_id);
    CREATE TABLE IF NOT EXISTS ${prefix}seo_pipeline_projection_versions (version INTEGER PRIMARY KEY);

    CREATE OR REPLACE FUNCTION ${prefix}refresh_seo_pipeline_identity(job_key TEXT,store_key TEXT,job_payload TEXT)
    RETURNS VOID LANGUAGE plpgsql AS $identity$
    DECLARE
      document JSONB := job_payload::jsonb;
      snapshot JSONB := COALESCE(NULLIF(document#>'{execution,originalSnapshot}','null'::jsonb),document->'original');
      primary_asin TEXT := upper(regexp_replace(snapshot->>'asin','^[[:space:]]+|[[:space:]]+$','','g'));
      parent_asin TEXT := upper(regexp_replace(snapshot->>'parentAsin','^[[:space:]]+|[[:space:]]+$','','g'));
    BEGIN
      INSERT INTO ${prefix}seo_pipeline_identities(job_id,store_id,source_key,source_revision,owner_item_id)
      VALUES(job_key,store_key,COALESCE(document#>>'{execution,sourceIdentity}',document->>'sourceIdentity',''),
        COALESCE(document#>>'{execution,sourceRevision}',document->>'sourceRevision',''),
        COALESCE(snapshot->>'crawlerPipelineItemId',''))
      ON CONFLICT(job_id) DO UPDATE SET store_id=excluded.store_id,source_key=excluded.source_key,
        source_revision=excluded.source_revision,owner_item_id=excluded.owner_item_id;
      DELETE FROM ${prefix}seo_pipeline_asins WHERE job_id=job_key;
      INSERT INTO ${prefix}seo_pipeline_asins(store_id,asin,job_id)
      SELECT store_key,asin,job_key FROM (
        SELECT primary_asin AS asin WHERE primary_asin ~ '^[A-Z0-9]{10}$'
        UNION
        SELECT upper(regexp_replace(CASE WHEN jsonb_typeof(variant)='object' THEN variant->>'asin'
          WHEN jsonb_typeof(variant)='string' THEN variant#>>'{}' END,'^[[:space:]]+|[[:space:]]+$','','g')) AS asin
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(snapshot->'sourceVariants')='array'
          THEN snapshot->'sourceVariants' ELSE '[]'::jsonb END) AS variants(variant)
      ) exact_asins WHERE asin ~ '^[A-Z0-9]{10}$' AND (asin=primary_asin OR asin IS DISTINCT FROM parent_asin);
    END $identity$;

    CREATE OR REPLACE FUNCTION ${prefix}project_seo_pipeline_job() RETURNS TRIGGER LANGUAGE plpgsql AS $identity$
    BEGIN
      PERFORM ${prefix}refresh_seo_pipeline_identity(NEW.id,NEW.store_id,NEW.payload);
      RETURN NEW;
    END $identity$;
    DROP TRIGGER IF EXISTS seo_pipeline_job_projection ON ${prefix}gpt_jobs;
    CREATE TRIGGER seo_pipeline_job_projection AFTER INSERT OR UPDATE OF payload,store_id ON ${prefix}gpt_jobs
      FOR EACH ROW EXECUTE FUNCTION ${prefix}project_seo_pipeline_job();

    CREATE OR REPLACE FUNCTION ${prefix}project_reactivated_seo_pipeline_job() RETURNS TRIGGER LANGUAGE plpgsql AS $identity$
    BEGIN
      IF NEW.pipeline_active AND NOT EXISTS(SELECT 1 FROM ${prefix}seo_pipeline_identities WHERE job_id=NEW.job_id) THEN
        PERFORM ${prefix}refresh_seo_pipeline_identity(id,store_id,payload) FROM ${prefix}gpt_jobs WHERE id=NEW.job_id;
      END IF;
      RETURN NEW;
    END $identity$;
    DROP TRIGGER IF EXISTS seo_pipeline_worker_projection ON ${prefix}seo_worker_jobs;
    CREATE TRIGGER seo_pipeline_worker_projection AFTER INSERT OR UPDATE OF pipeline_active ON ${prefix}seo_worker_jobs
      FOR EACH ROW EXECUTE FUNCTION ${prefix}project_reactivated_seo_pipeline_job();

    DO $backfill$
    DECLARE legacy RECORD;
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM ${prefix}seo_pipeline_projection_versions WHERE version=1) THEN
        FOR legacy IN SELECT j.id,j.store_id,j.payload FROM ${prefix}gpt_jobs j
          JOIN ${prefix}seo_worker_jobs w ON w.job_id=j.id
          WHERE w.pipeline_active AND j.status!='CANCELLED'
        LOOP
          PERFORM ${prefix}refresh_seo_pipeline_identity(legacy.id,legacy.store_id,legacy.payload);
        END LOOP;
        INSERT INTO ${prefix}seo_pipeline_projection_versions VALUES(1);
      END IF;
    END $backfill$;
  `;
}
