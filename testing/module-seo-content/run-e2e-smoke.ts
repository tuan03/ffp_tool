import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

import type { SeoPipelineContext } from "../../src/modules/seo-content/internal/domain-types";
import type { SeoContentOutput } from "../../src/modules/seo-content/types";

import {
  createTracingStages,
  parseSmokeInput,
  parseSmokeInputs,
  serializeSeoOutput,
  type SmokeStageTrace,
} from "./e2e-smoke-helpers";
import {
  renderSmokeReport,
  type SmokeProductItemSummary,
  type SmokeRunSummary,
  type StageSnapshot,
} from "./report-renderer";
import { loadSmokePipelineRuntime } from "./runtime-loader";

const executeFile = promisify(execFile);
const TESTING_DIRECTORY = path.resolve(process.cwd(), "testing", "module-seo-content");
const DEFAULT_FIXTURE_PATH = path.join(TESTING_DIRECTORY, "smoke-input.json");

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function stageSummary(context: SeoPipelineContext, stageName: SmokeStageTrace["stageName"]): Record<string, unknown> {
  switch (stageName) {
    case "b1":
      return { productUnderstanding: context.productUnderstanding };
    case "b2":
      return { shoppingContext: context.shoppingContext };
    case "b3":
      return { searchResearch: context.searchResearch };
    case "b4":
      return context.conflictResult
        ? {
            conflictResult: {
              approvedKeywords: context.conflictResult.approvedKeywords,
              discardedKeywords: context.conflictResult.discardedKeywords,
              conflictReasons: context.conflictResult.conflictReasons,
              relevanceScores: context.conflictResult.relevanceScores,
              keywordClusters: context.conflictResult.keywordClusters,
              corpusRevision: context.conflictResult.corpusRevision,
            },
          }
        : {};
    case "b5":
      return {
        contentResult: context.contentResult,
        contentGenerationMetadata: context.contentGenerationMetadata,
      };
    case "b6":
      return {
        imageResult: context.imageResult
          ? {
              processedImages: context.imageResult.processedImages.map((image) => ({
                sourceUrl: image.sourceUrl,
                alt: image.alt,
                webp: { filename: image.webp.filename },
              })),
            }
          : undefined,
        imageProcessingMetadata: context.imageProcessingMetadata,
      };
  }
}

function snapshotTrace(trace: SmokeStageTrace): StageSnapshot {
  return {
    stageName: trace.stageName,
    ...(trace.context.effectiveNiche ? { effectiveNiche: trace.context.effectiveNiche } : {}),
    summary: stageSummary(trace.context, trace.stageName),
  };
}

function isNoOpenFlag(value: string): boolean {
  return value === "--no-open";
}

function parseArguments(args: readonly string[]): { readonly fixturePath: string; readonly shouldOpen: boolean } {
  const fixtureArgument = args.find((argument) => !isNoOpenFlag(argument));
  return {
    fixturePath: fixtureArgument ? path.resolve(process.cwd(), fixtureArgument) : DEFAULT_FIXTURE_PATH,
    shouldOpen: !args.some(isNoOpenFlag),
  };
}

function createRunDirectoryName(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function writeWebpArtifacts(
  output: SeoContentOutput | undefined,
  runDirectory: string,
  prefix = "",
): Promise<ReadonlyMap<string, string>> {
  const artifactUrls = new Map<string, string>();
  if (!output) return artifactUrls;

  const imagesDirectory = path.join(runDirectory, "images");
  await fs.mkdir(imagesDirectory, { recursive: true });
  for (const image of output.images) {
    const data = image.webp.data;
    if (!data || !(Buffer.isBuffer(data) || data instanceof Uint8Array)) continue;
    const baseFilename = path.basename(image.webp.filename);
    const diskFilename = prefix ? `${prefix}_${baseFilename}` : baseFilename;
    await fs.writeFile(path.join(imagesDirectory, diskFilename), data);
    artifactUrls.set(image.webp.filename, `images/${encodeURIComponent(diskFilename)}`);
  }
  return artifactUrls;
}

async function validateLocalImageFiles(input: { readonly images: readonly { readonly localFilePath?: string }[] }): Promise<void> {
  for (const image of input.images) {
    if (!image.localFilePath) continue;
    try {
      await fs.access(image.localFilePath);
    } catch {
      throw new Error(`Local image does not exist: ${image.localFilePath}`);
    }
  }
}

async function openReport(reportPath: string): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await executeFile("cmd.exe", ["/c", "start", "", reportPath]);
  } catch {
    // The report path printed by the caller remains usable if the OS cannot open a browser.
  }
}

async function main(): Promise<void> {
  const pipelineRuntime = await loadSmokePipelineRuntime();
  const { fixturePath, shouldOpen } = parseArguments(process.argv.slice(2));
  const repositoryRoot = process.cwd();
  const startedAt = new Date();
  const rawFixture = JSON.parse(await fs.readFile(fixturePath, "utf8")) as unknown;
  const inputs = parseSmokeInputs(rawFixture, repositoryRoot);

  if (inputs.length === 0) {
    throw new Error("No products found to process in smoke fixture");
  }

  console.log("\n=======================================================");
  console.log(`SEO Content manual smoke: B1 -> B6 (${inputs.length} product${inputs.length > 1 ? "s" : ""})`);
  console.log(`Fixture: ${fixturePath}`);
  console.log("=======================================================");

  const runDirectory = path.join(TESTING_DIRECTORY, "output", createRunDirectoryName(startedAt));
  await fs.mkdir(runDirectory, { recursive: true });

  const productSummaries: SmokeProductItemSummary[] = [];
  const mergedArtifactUrls = new Map<string, string>();
  let hasAnyFailure = false;

  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index]!;
    const productNumber = index + 1;
    console.log(`\n▶ [Product ${productNumber}/${inputs.length}] "${input.title}"`);
    console.log(`  Images: ${input.images.length}; niche: "${input.niche}"; siteDomain: ${input.siteDomain ?? "not provided"}`);

    await validateLocalImageFiles(input);

    const traces: StageSnapshot[] = [];
    const pipeline = pipelineRuntime.createSeoPipeline({
      siteNicheResolver: pipelineRuntime.siteNicheResolver,
      stages: createTracingStages(pipelineRuntime.stages, (trace) => {
        traces.push(snapshotTrace(trace));
        console.log(`  [P${productNumber} · ${trace.stageName.toUpperCase()}] completed`);
      }),
    });

    const itemStartedAt = Date.now();
    let output: SeoContentOutput | undefined;
    let itemError: string | undefined;

    try {
      output = await pipeline.execute(input);
      console.log(`  ✓ Completed B1 -> B6 for Product #${productNumber} (${output.images.length} image output(s)).`);
    } catch (caughtError) {
      itemError = caughtError instanceof Error ? caughtError.message : String(caughtError);
      hasAnyFailure = true;
      console.error(`  ✗ Product #${productNumber} failed: ${itemError}`);
    }

    const itemDurationMs = Date.now() - itemStartedAt;
    const prefix = inputs.length > 1 ? `p${productNumber}` : "";
    const itemArtifacts = await writeWebpArtifacts(output, runDirectory, prefix);
    for (const [key, val] of itemArtifacts.entries()) {
      mergedArtifactUrls.set(key, val);
    }

    productSummaries.push({
      productIndex: index,
      input: {
        title: input.title,
        niche: input.niche,
        ...(input.siteDomain ? { siteDomain: input.siteDomain } : {}),
        imageCount: input.images.length,
      },
      durationMs: itemDurationMs,
      stageTraces: traces,
      ...(output ? { output: serializeSeoOutput(output) } : {}),
      ...(itemError ? { error: itemError } : {}),
    });
  }

  const completedAt = new Date();
  const firstItem = productSummaries[0]!;

  const summary: SmokeRunSummary = {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    input: {
      title: inputs.length === 1 ? firstItem.input.title : `${inputs.length} products batch`,
      niche: inputs.length === 1 ? firstItem.input.niche : "Multi-niche",
      ...(inputs.length === 1 && firstItem.input.siteDomain ? { siteDomain: firstItem.input.siteDomain } : {}),
      imageCount: inputs.reduce((total, it) => total + it.images.length, 0),
    },
    environment: {
      ...(process.env.GOOGLE_CLOUD_PROJECT ? { googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT } : {}),
      ...(process.env.SEO_SEARCH_PROVIDER ? { searchProvider: process.env.SEO_SEARCH_PROVIDER } : {}),
    },
    stageTraces: firstItem.stageTraces,
    ...(firstItem.output ? { output: firstItem.output } : {}),
    ...(hasAnyFailure
      ? {
          error: productSummaries
            .filter((p) => p.error)
            .map((p) => `Product #${p.productIndex + 1}: ${p.error}`)
            .join("; "),
        }
      : {}),
    totalProducts: inputs.length,
    items: productSummaries,
  };

  const reportPath = path.join(runDirectory, "report.html");
  await fs.writeFile(path.join(runDirectory, "summary.json"), toJson(summary), "utf8");
  await fs.writeFile(reportPath, renderSmokeReport(summary, mergedArtifactUrls), "utf8");
  console.log(`\n=======================================================`);
  console.log(`Report generated: ${reportPath}`);
  console.log(`Summary JSON:     ${path.join(runDirectory, "summary.json")}`);
  console.log("=======================================================");

  if (shouldOpen) await openReport(reportPath);
  if (hasAnyFailure) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`Unable to start SEO Content smoke run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
