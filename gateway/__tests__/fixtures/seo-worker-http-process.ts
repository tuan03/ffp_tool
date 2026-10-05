import http from "node:http";
import { PostgresCustomGptQueue } from "../../custom-gpt-seo/postgres-queue";
import { handleWorkerMcp } from "../../seo-worker/mcp-handler";
import { createWorkerWorkflow } from "../../seo-worker/workflow";

const [schema] = process.argv.slice(2);
const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;
if (!databaseUrl || !/^seo_worker_http_[a-f0-9]{32}$/.test(schema ?? "")) throw new Error("TEST_CONFIGURATION_REQUIRED");
const queue = new PostgresCustomGptQueue({ databaseUrl, schema });
await queue.initialize();
const workflow = createWorkerWorkflow(queue.workers, { checkSource: async () => undefined });
const server = http.createServer((request, response) => { void handleWorkerMcp(request, response, queue.workers, workflow); });
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string") process.send?.({ port: address.port });
});
