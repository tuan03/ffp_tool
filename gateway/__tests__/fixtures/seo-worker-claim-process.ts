import { PostgresCustomGptQueue } from "../../custom-gpt-seo/postgres-queue";

const [schema, workerId] = process.argv.slice(2);
const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;
if (!databaseUrl || !/^seo_worker_test_[a-f0-9]{32}$/.test(schema ?? "") || !workerId) {
  throw new Error("Dedicated PostgreSQL worker test configuration required");
}
const queue = new PostgresCustomGptQueue({ databaseUrl, schema });
try {
  await queue.initialize();
  const { token } = await queue.workers.issueToken({ storeId: "worker-test", workerId, createdBy: "integration-test" });
  const { sessionId } = await queue.workers.register(token, "register");
  const run = await queue.workers.startRun(token, sessionId, 1, "start");
  const claim = await queue.workers.claim(token, sessionId, run.id, "claim");
  if (!claim.lease) throw new Error("Expected an available test job");
  process.stdout.write(JSON.stringify({ jobId: claim.lease.jobId }));
} finally { await queue.close(); }
