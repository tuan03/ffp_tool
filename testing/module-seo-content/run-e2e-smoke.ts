import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

import type { SeoPipelineContext } from "../../src/modules/seo-content/internal/domain-types";
import type { SeoContentOutput } from "../../src/modules/seo-content/types";

import {
  createTracingStages,
  parseSmokeInput,
  serializeSeoOutput,
  type SmokeStageTrace,
} from "./e2e-smoke-helpers";
import { renderSmokeReport, type SmokeRunSummary, type StageSnapshot } from "./report-renderer";
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

async function writeWebpArtifacts(output: SeoContentOutput | undefined, runDirectory: string): Promise<ReadonlyMap<string, string>> {
  const artifactUrls = new Map<string, string>();
  if (!output) return artifactUrls;

  const imagesDirectory = path.join(runDirectory, "images");
  await fs.mkdir(imagesDirectory, { recursive: true });
  for (const image of output.images) {
    const data = image.webp.data;
    if (!data || !(Buffer.isBuffer(data) || data instanceof Uint8Array)) continue;
    const filename = path.basename(image.webp.filename);
    await fs.writeFile(path.join(imagesDirectory, filename), data);
    artifactUrls.set(image.webp.filename, `images/${encodeURIComponent(filename)}`);
  }
  return artifactUrls;
}

async function validateLocalImageFiles(input: ReturnType<typeof parseSmokeInput>): Promise<void> {
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
  const input = parseSmokeInput(rawFixture, repositoryRoot);
  await validateLocalImageFiles(input);
  const traces: StageSnapshot[] = [];
  const pipeline = pipelineRuntime.createSeoPipeline({
    siteNicheResolver: pipelineRuntime.siteNicheResolver,
    stages: createTracingStages(pipelineRuntime.stages, (trace) => {
      traces.push(snapshotTrace(trace));
      console.log(`[${trace.stageName.toUpperCase()}] completed`);
    }),
  });

  console.log("\nSEO Content manual smoke: B1 -> B6");
  console.log(`Fixture: ${fixturePath}`);
  console.log(`Images: ${input.images.length}; siteDomain: ${input.siteDomain ?? "not provided"}`);

  let output: SeoContentOutput | undefined;
  let error: string | undefined;
  try {
    output = await pipeline.execute(input);
    console.log(`Completed B1 -> B6 with ${output.images.length} image output(s).`);
  } catch (caughtError) {
    error = caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.error(`Smoke run failed: ${error}`);
  }

  const completedAt = new Date();
  const runDirectory = path.join(TESTING_DIRECTORY, "output", createRunDirectoryName(startedAt));
  await fs.mkdir(runDirectory, { recursive: true });
  const artifactUrls = await writeWebpArtifacts(output, runDirectory);
  const summary: SmokeRunSummary = {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    input: {
      title: input.title,
      niche: input.niche,
      ...(input.siteDomain ? { siteDomain: input.siteDomain } : {}),
      imageCount: input.images.length,
    },
    environment: {
      ...(process.env.GOOGLE_CLOUD_PROJECT ? { googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT } : {}),
      ...(process.env.SEO_SEARCH_PROVIDER ? { searchProvider: process.env.SEO_SEARCH_PROVIDER } : {}),
    },
    stageTraces: traces,
    ...(output ? { output: serializeSeoOutput(output) } : {}),
    ...(error ? { error } : {}),
  };
  const reportPath = path.join(runDirectory, "report.html");
  await fs.writeFile(path.join(runDirectory, "summary.json"), toJson(summary), "utf8");
  await fs.writeFile(reportPath, renderSmokeReport(summary, artifactUrls), "utf8");
  console.log(`Report: ${reportPath}`);

  if (shouldOpen) await openReport(reportPath);
  if (error) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`Unable to start SEO Content smoke run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
