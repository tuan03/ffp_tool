import { getWorkerContracts } from "../gateway/seo-worker/mcp-server";
process.stdout.write(JSON.stringify(getWorkerContracts()));
