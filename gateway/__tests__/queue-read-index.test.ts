import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";

test("visible queue index preserves archive semantics and avoids reading snapshots for counts", async () => {
  const database = await PGlite.create();
  try {
    await database.exec(getQueueSchemaSql("public"));
    await database.exec(`INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at)
      SELECT i::text, CASE WHEN i=2000 THEN 'other' ELSE 'sample' END, i::text,
        CASE WHEN i=1999 THEN 'CANCELLED' ELSE 'FAILED' END,
        jsonb_build_object('original',repeat('large snapshot ',2000),
          'queueArchivedAt',CASE WHEN i<1990 THEN to_jsonb(1000) ELSE 'null'::jsonb END)::text,i
      FROM generate_series(1,2000) i;
      ANALYZE gpt_jobs;`);
    const query = `SELECT count(*) FROM gpt_jobs WHERE store_id='sample' AND status!='CANCELLED'
      AND COALESCE(payload::jsonb->>'queueArchivedAt','')=''`;
    assert.equal(Number((await database.query<{ count: string }>(query)).rows[0].count), 9);
    const plan = await database.query(`EXPLAIN ${query}`);
    assert.match(JSON.stringify(plan.rows), /gpt_visible_queue_idx/);
    await database.exec(`UPDATE gpt_jobs SET payload=(payload::jsonb || '{"queueArchivedAt":2000}')::text WHERE id='1990'`);
    assert.equal(Number((await database.query<{ count: string }>(query)).rows[0].count), 8);
    await database.exec(`UPDATE gpt_jobs SET payload=(payload::jsonb - 'queueArchivedAt')::text WHERE id='1990'`);
    assert.equal(Number((await database.query<{ count: string }>(query)).rows[0].count), 9);
  } finally { await database.close(); }
});
