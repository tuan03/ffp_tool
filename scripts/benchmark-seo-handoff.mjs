import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";

import { getQueueSchemaSql } from "../gateway/custom-gpt-seo/postgres-database.ts";

// Local synthetic data only: no Shopify requests, credentials or production writes.
const database = await PGlite.create();
try {
  await database.exec(getQueueSchemaSql("public"));
  await database.exec(`WITH products AS (
      SELECT n,jsonb_build_object('asin','B0'||lpad(n::text,8,'0'),'parentAsin','B0PARENT01',
        'crawlerPipelineItemId','owner-'||n,'unusedSnapshot',repeat('synthetic-data-',2400),
        'sourceVariants',jsonb_build_array(jsonb_build_object('asin','B0'||lpad(n::text,8,'0')))) AS snapshot
      FROM generate_series(1,400) AS n
    ) INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at)
    SELECT 'job-'||n,'sample','dedup-'||n,'PENDING',jsonb_build_object(
      'sourceIdentity','amazon:synthetic:'||n,'original',snapshot,
      'execution',jsonb_build_object('sourceIdentity','amazon:synthetic:'||n,'originalSnapshot',snapshot))::text,1000
    FROM products;
    INSERT INTO seo_worker_jobs(job_id,store_id,product_key,state,updated_at)
      SELECT id,store_id,id,'READY',1000 FROM gpt_jobs;
    ANALYZE gpt_jobs; ANALYZE seo_worker_jobs; ANALYZE seo_pipeline_asins; ANALYZE seo_pipeline_identities;`);
  const snapshot = "COALESCE(j.payload::jsonb#>'{execution,originalSnapshot}',j.payload::jsonb->'original')";
  const oldQuery = `SELECT j.id,COALESCE(j.payload::jsonb#>>'{execution,sourceIdentity}',j.payload::jsonb->>'sourceIdentity') AS source_key,
    jsonb_build_object('asin',(${snapshot})->'asin','parentAsin',(${snapshot})->'parentAsin',
      'sourceVariants',jsonb_path_query_array((${snapshot}),'$.sourceVariants[*].asin'),
      'crawlerPipelineItemId',(${snapshot})->'crawlerPipelineItemId') AS identity
    FROM gpt_jobs j JOIN seo_worker_jobs w ON w.job_id=j.id
    WHERE j.store_id='sample' AND w.pipeline_active AND j.status!='CANCELLED'`;
  const newQuery = `SELECT i.job_id,i.source_key,i.owner_item_id,a.asin FROM seo_pipeline_asins a
    JOIN seo_pipeline_identities i ON i.job_id=a.job_id JOIN seo_worker_jobs w ON w.job_id=a.job_id
    JOIN gpt_jobs j ON j.id=a.job_id WHERE a.store_id='sample' AND a.asin='B000000123'
    AND w.pipeline_active AND j.status!='CANCELLED'`;
  const startedOld = performance.now();
  const oldRows = (await database.query(oldQuery)).rows;
  const oldMs = performance.now() - startedOld;
  const startedNew = performance.now();
  const newRows = (await database.query(newQuery)).rows;
  const newMs = performance.now() - startedNew;
  assert.equal(oldRows.length, 400);
  assert.equal(newRows.length, 1);
  assert.equal(newRows[0].job_id, "job-123");
  const size = (await database.query("SELECT round(sum(octet_length(payload))/1048576.0,2) AS mb FROM gpt_jobs")).rows[0].mb;
  console.log(JSON.stringify({ syntheticJobs: 400, payloadMb: size, legacyScanMs: Math.round(oldMs),
    indexedLookupMs: Number(newMs.toFixed(2)), speedup: Number((oldMs / newMs).toFixed(1)) }));
} finally { await database.close(); }
