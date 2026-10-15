import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { getSeoPipelineIdentitySchemaSql } from "../custom-gpt-seo/pipeline-identity-schema";

test("identity projection normalizes exact children, excludes parent aliases and tracks payload changes", async () => {
  const database = await PGlite.create();
  try {
    await database.exec(getQueueSchemaSql("public"));
    const snapshot = { asin: " \tb0child001\n ", parentAsin: "B0PARENT01", crawlerPipelineItemId: "owner",
      sourceVariants: [{ asin: "\rB0CHILD002\t" }, { asin: "B0PARENT01" }, "b0child002", { asin: "invalid" }] };
    const payload = { execution: { sourceIdentity: "amazon:family:style:red", sourceRevision: "r1", originalSnapshot: snapshot } };
    await database.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at) VALUES ('job','sample','dedup','PENDING',$1,1000)", [JSON.stringify(payload)]);
    assert.deepEqual((await database.query("SELECT asin FROM seo_pipeline_asins ORDER BY asin")).rows,
      [{ asin: "B0CHILD001" }, { asin: "B0CHILD002" }]);
    assert.deepEqual((await database.query("SELECT owner_item_id,source_revision FROM seo_pipeline_identities")).rows,
      [{ owner_item_id: "owner", source_revision: "r1" }]);
    await database.query("UPDATE gpt_jobs SET payload=$1 WHERE id='job'", [JSON.stringify({
      ...payload, execution: { ...payload.execution, originalSnapshot: { asin: "B0CHILD003" } },
    })]);
    assert.deepEqual((await database.query("SELECT asin FROM seo_pipeline_asins")).rows, [{ asin: "B0CHILD003" }]);
    await database.query("DELETE FROM gpt_jobs WHERE id='job'");
    assert.equal((await database.query("SELECT * FROM seo_pipeline_asins")).rows.length, 0);
  } finally { await database.close(); }
});

test("upgrade backfills active jobs once and projects an old job when it is reactivated", async () => {
  const database = await PGlite.create();
  try {
    // Simulate a pre-upgrade queue, including a closed historical job.
    await database.exec(`CREATE TABLE gpt_jobs(id TEXT PRIMARY KEY,store_id TEXT,status TEXT,payload TEXT);
      CREATE TABLE seo_worker_jobs(job_id TEXT PRIMARY KEY,pipeline_active BOOLEAN);`);
    for (const [id, active] of [["active", true], ["closed", false]] as const) {
      await database.query("INSERT INTO gpt_jobs VALUES ($1,'sample','PENDING',$2)",
        [id, JSON.stringify({ sourceIdentity: id, original: { asin: "B0CHILD001" } })]);
      await database.query("INSERT INTO seo_worker_jobs VALUES ($1,$2)", [id, active]);
    }
    await database.exec(getSeoPipelineIdentitySchemaSql("public"));
    assert.deepEqual((await database.query("SELECT job_id FROM seo_pipeline_identities")).rows, [{ job_id: "active" }]);
    await database.exec(getSeoPipelineIdentitySchemaSql("public"));
    assert.equal((await database.query("SELECT * FROM seo_pipeline_asins")).rows.length, 1);
    await database.query("UPDATE seo_worker_jobs SET pipeline_active=true WHERE job_id='closed'");
    assert.equal((await database.query("SELECT * FROM seo_pipeline_asins")).rows.length, 2);
    await database.query("UPDATE seo_worker_jobs SET pipeline_active=false WHERE job_id='active'");
    const matches = await database.query(`SELECT a.job_id FROM seo_pipeline_asins a JOIN seo_worker_jobs w ON w.job_id=a.job_id
      JOIN gpt_jobs j ON j.id=a.job_id WHERE a.store_id='sample' AND a.asin='B0CHILD001'
      AND w.pipeline_active AND j.status!='CANCELLED'`);
    assert.deepEqual(matches.rows, [{ job_id: "closed" }]);
  } finally { await database.close(); }
});

test("projection and job roll back together and identities remain isolated in a custom schema", async () => {
  const database = await PGlite.create();
  try {
    await database.exec(getQueueSchemaSql("identity_test"));
    const insert = `INSERT INTO identity_test.gpt_jobs(id,store_id,dedup,status,payload,created_at)
      VALUES ($1,$2,$1,'PENDING',$3,1000)`;
    const payload = JSON.stringify({ sourceIdentity: "amazon:legacy", original: { asin: "B0CHILD001" } });
    await assert.rejects(database.transaction(async transaction => {
      await transaction.query(insert, ["rollback", "sample", payload]);
      throw new Error("abort");
    }), /abort/);
    assert.equal((await database.query("SELECT * FROM identity_test.seo_pipeline_asins")).rows.length, 0);
    await database.query(insert, ["a", "sample", payload]);
    await database.query(insert, ["b", "other", payload]);
    assert.deepEqual((await database.query("SELECT job_id FROM identity_test.seo_pipeline_asins WHERE store_id='sample' AND asin='B0CHILD001'")).rows,
      [{ job_id: "a" }]);
    await database.query("UPDATE identity_test.gpt_jobs SET store_id='moved' WHERE id='a'");
    assert.equal((await database.query("SELECT * FROM identity_test.seo_pipeline_asins WHERE store_id='sample'")).rows.length, 0);
    assert.equal((await database.query("SELECT * FROM identity_test.seo_pipeline_asins WHERE store_id='moved'")).rows.length, 1);
  } finally { await database.close(); }
});
