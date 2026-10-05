import { PostgresCustomGptQueue } from "../../custom-gpt-seo/postgres-queue";
import { processSeoPublish } from "../../seo-worker/publish-worker";

const [schema, mode] = process.argv.slice(2);
const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;
if (!databaseUrl || !/^seo_publish_test_[a-f0-9]+$/.test(schema ?? "") || !["leave-write", "recover"].includes(mode)) throw new Error("TEST_CONFIGURATION_REQUIRED");
const queue = new PostgresCustomGptQueue({ databaseUrl, schema });
try {
  await queue.initialize();
  if (mode === "leave-write") {
    const lease = await queue.publisher.claim();
    if (!lease) throw new Error("TEST_LEASE_REQUIRED");
    await queue.publisher.authorizeWrite(lease);
    // Exit with a persisted write intent and no receipt, like a process lost mid-write.
  } else {
    await processSeoPublish(queue.publisher, {
      read: async operation => ({ version: "remote-write-confirmed", fields: operation.fields }),
      write: async () => { throw new Error("RECOVERY_MUST_NOT_RESEND"); },
    });
  }
} finally { await queue.close(); }
