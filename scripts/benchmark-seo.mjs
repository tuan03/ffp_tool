import fs from "node:fs/promises";
import { setDefaultResultOrder } from "node:dns";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Match the production worker: this server has unreliable IPv6 image connections.
setDefaultResultOrder("ipv4first");

// Runs only SEO and writes only to a new benchmark directory; never calls Shopify.
const args = new Map(process.argv.slice(2).map(arg => {
  const separator = arg.indexOf("=");
  return [arg.slice(0, separator), arg.slice(separator + 1)];
}));
const required = name => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing ${name}=...`);
  return value;
};
const workers = Number(args.get("--workers") ?? 8);
const gemini = Number(args.get("--gemini") ?? 4);
if (![workers, gemini].every(value => Number.isInteger(value) && value > 0 && value <= 16)) {
  throw new Error("Concurrency must be an integer from 1 to 16");
}
const codeRoot = path.resolve(args.get("--code-root") ?? ".");
const outputDirectory = path.resolve(required("--output"));
const products = JSON.parse(await fs.readFile(required("--inputs"), "utf8"));
if (!Array.isArray(products) || products.length < 20) throw new Error("Benchmark requires at least 20 products");
await fs.mkdir(outputDirectory); // Refuse to overwrite an earlier run or an existing corpus.
const corpusPath = path.join(outputDirectory, "corpus.json");
const seedCorpus = JSON.parse(await fs.readFile(required("--corpus"), "utf8"));
const storeId = args.get("--store") ?? seedCorpus.products?.find(product => product.storeId)?.storeId;
if (!storeId) throw new Error("Specify --store for a corpus with no store scope");
await fs.copyFile(required("--corpus"), corpusPath, fs.constants.COPYFILE_EXCL);
const { loadLocalEnv } = await import("../gateway/index.ts");
const env = { ...loadLocalEnv("src/modules/seo-content"), ...loadLocalEnv() };
for (const [key, value] of Object.entries(env)) {
  if (/^(AI_|GOOGLE_|GEMINI_|SEO_)/.test(key) && process.env[key] === undefined) process.env[key] = value;
}
process.env.GEMINI_REQUEST_CONCURRENCY = String(gemini);
process.env.GEMINI_VISION_CONCURRENCY = String(args.get("--baseline") === "true" ? 1 : gemini);
process.env.SEO_EMBEDDING_CONCURRENCY = "2";
process.env.SEO_CONFLICT_CORPUS_PATH = corpusPath;
if (!process.env.GOOGLE_CLOUD_PROJECT) throw new Error("Live benchmark requires Google Cloud configuration");

const requests = { gemini: 0, embedding: 0, suggest: 0 };
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes(":generateContent")) requests.gemini++;
  else if (url.includes(":embedContent") || url.includes(":predict")) requests.embedding++;
  else if (url.includes("suggestqueries.google.com")) requests.suggest++;
  return originalFetch(input, options);
};
// Existing module warnings can contain product text; benchmark artifacts contain counters only.
let warningCount = 0;
console.warn = () => { warningCount++; };
const seo = await import(pathToFileURL(path.join(codeRoot, "src/modules/seo-content/index.ts")).href);
const corpus = new seo.FileSeoConflictCorpus({ filePath: corpusPath });
const coordinator = new seo.SeoCorpusCommitCoordinator();
const samples = [];
let next = 0;
const startedAt = Date.now();
await Promise.all(Array.from({ length: workers }, async () => {
  while (next < products.length) {
    const index = next++;
    const input = { ...seo.fromCustomizationProduct(products[index]), storeId };
    const signal = AbortSignal.timeout(10 * 60_000);
    const options = { imageMode: "alt_only", dependencies: { conflictCorpus: corpus }, signal };
    const session = seo.createSeoContentSession?.(input, options);
    const productStartedAt = Date.now();
    try {
      const prepared = await coordinator.prepare({
        corpusKey: corpusPath,
        signal,
        runSeo: () => session ? session.run() : seo.runSeoContentDetailed(input, options),
        register: execution => corpus.upsertProduct({
          identity: { storeId: input.storeId, productId: input.productId, handle: execution.output.productHandle },
          title: execution.output.productTitle,
          expectedRevision: execution.metadata.corpusRevision,
          approvedKeywords: execution.metadata.approvedKeywords.map((keyword, rank) => ({
            keyword, rank, embedding: execution.metadata.approvedEmbeddings?.[keyword],
          })),
        }),
      });
      samples.push({ index, durationMs: Date.now() - productStartedAt, success: true,
        fallbackStages: prepared.execution.metadata.fallbackStages,
        warningCodes: prepared.execution.metadata.warnings?.map(warning =>
          /No readable product images/.test(warning) ? `IMAGE_READ_FAILED:${warning.match(/reasons: (HTTP [0-9]{3}|download failed|timeout|image too large|unsupported image format|invalid image URL|no images provided)/)?.[1] ?? "unknown"}`
            : /JSON|schema|typography|structured response/.test(warning) ? "SCHEMA_INVALID"
              : /timed out|timeout/i.test(warning) ? "TIMEOUT"
                : /429|quota|rate limit/i.test(warning) ? "RATE_LIMIT"
                  : /embedding/i.test(warning) ? "EMBEDDING_FALLBACK" : "OTHER"),
        revisionRetries: prepared.revisionRetries, timings: prepared.timings,
        performance: prepared.execution.metadata.performance });
    } catch (error) {
      samples.push({ index, durationMs: Date.now() - productStartedAt, success: false,
        errorName: error instanceof Error ? error.name : "UnknownError" });
    }
    console.log(JSON.stringify({ completed: samples.length, total: products.length }));
    const sample = samples.find(sample => sample.index === index);
    await fs.writeFile(path.join(outputDirectory, `sample-${index}.json`), JSON.stringify(sample, null, 2));
  }
}));
const elapsedMs = Date.now() - startedAt;
await fs.writeFile(path.join(outputDirectory, "samples.json"), JSON.stringify(samples, null, 2));
const durations = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
const successful = samples.filter(sample => sample.success).length;
const percentile = p => durations[Math.min(durations.length - 1, Math.ceil(p * durations.length) - 1)];
const report = {
  baseline: args.get("--baseline") === "true",
  workers, gemini, products: products.length, successful, elapsedMs,
  productsPerMinute: successful * 60_000 / elapsedMs, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
  errors: samples.length - successful,
  fallbackProducts: samples.filter(sample => sample.fallbackStages?.length).length,
  requests, warningCount,
  model: process.env.GEMINI_MODEL, analysisModel: process.env.GEMINI_ANALYSIS_MODEL,
  embeddingModel: process.env.SEO_EMBEDDING_MODEL ?? "text-embedding-004",
};
await fs.writeFile(path.join(outputDirectory, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
