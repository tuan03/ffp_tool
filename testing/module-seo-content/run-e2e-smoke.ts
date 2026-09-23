import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

import { loadServerEnvironment } from "../../src/config/server-environment";
import { DEFAULT_SEO_PIPELINE_STAGES, createSeoPipeline } from "../../src/modules/seo-content/internal/pipeline";
import { getDefaultSiteNicheResolver } from "../../src/modules/seo-content/internal/site-niche/site-niche-runtime";
import type { SeoPipelineContext } from "../../src/modules/seo-content/internal/domain-types";
import type { SeoContentOutput } from "../../src/modules/seo-content/types";

import {
  createTracingStages,
  parseSmokeInput,
  serializeSeoOutput,
  type SerializedSeoOutput,
  type SmokeStageTrace,
} from "./e2e-smoke-helpers";

const executeFile = promisify(execFile);
const TESTING_DIRECTORY = path.resolve(process.cwd(), "testing", "module-seo-content");
const DEFAULT_FIXTURE_PATH = path.join(TESTING_DIRECTORY, "smoke-input.json");

interface SmokeRunSummary {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly input: {
    readonly title: string;
    readonly niche: string;
    readonly siteDomain?: string;
    readonly imageCount: number;
  };
  readonly environment: {
    readonly googleCloudProject?: string;
    readonly searchProvider?: string;
  };
  readonly stageTraces: readonly StageSnapshot[];
  readonly output?: SerializedSeoOutput;
  readonly error?: string;
}

interface StageSnapshot {
  readonly stageName: SmokeStageTrace["stageName"];
  readonly effectiveNiche?: string;
  readonly summary: Record<string, unknown>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

function formatValue(value: unknown): string {
  return escapeHtml(toJson(value ?? {}));
}

function renderStageCards(traces: readonly StageSnapshot[]): string {
  return traces
    .map(
      (trace) => `
        <section class="card">
          <div class="stage-heading">
            <span class="badge">${escapeHtml(trace.stageName.toUpperCase())}</span>
            ${trace.effectiveNiche ? `<span>Effective niche: <strong>${escapeHtml(trace.effectiveNiche)}</strong></span>` : ""}
          </div>
          <pre>${formatValue(trace.summary)}</pre>
        </section>`,
    )
    .join("\n");
}

function renderImageGallery(output: SerializedSeoOutput, artifactUrls: ReadonlyMap<string, string>): string {
  return output.images
    .map((image, index) => {
      const artifactUrl = artifactUrls.get(image.webp.filename);
      const previewUrl = artifactUrl ?? image.sourceUrl;
      return `
        <article class="image-card">
          <img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(image.alt)}" loading="lazy" />
          <div>
            <strong>${index + 1}. ${escapeHtml(image.webp.filename)}</strong>
            <p>${escapeHtml(image.alt)}</p>
            <small>Alt length: ${[...image.alt].length}/125</small>
          </div>
        </article>`;
    })
    .join("\n");
}

function renderReport(summary: SmokeRunSummary, artifactUrls: ReadonlyMap<string, string>): string {
  const output = summary.output;
  const status = summary.error ? "FAILED" : "COMPLETED";
  const outputCard = output
    ? `
      <section class="card">
        <h2>B5 + final public output</h2>
        <dl>
          <dt>Product title</dt><dd>${escapeHtml(output.productTitle)}</dd>
          <dt>Handle</dt><dd>/products/${escapeHtml(output.productHandle)}</dd>
          <dt>SEO title</dt><dd>${escapeHtml(output.productSeoTitle)} (${output.productSeoTitle.length}/70)</dd>
          <dt>SEO description</dt><dd>${escapeHtml(output.productSeoDescription)} (${output.productSeoDescription.length}/160)</dd>
        </dl>
        <div class="description">${escapeHtml(output.productDescription)}</div>
      </section>
      <section class="card">
        <h2>B6 image output (${output.images.length})</h2>
        <div class="gallery">${renderImageGallery(output, artifactUrls)}</div>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SEO Content B1-B6 Smoke Report</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    body { margin: 0; padding: 32px 16px; }
    main { max-width: 1100px; margin: 0 auto; }
    h1, h2 { margin: 0 0 12px; } h1 { font-size: 28px; } h2 { font-size: 18px; }
    .meta, .card { background: #172033; border: 1px solid #334155; border-radius: 14px; padding: 18px; margin: 16px 0; }
    .meta { display: grid; gap: 6px; } .success { color: #34d399; } .failure { color: #fb7185; }
    .stage-heading { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
    .badge { background: #1d4ed8; border-radius: 99px; padding: 4px 9px; font-weight: 700; font-size: 12px; }
    pre { overflow: auto; background: #020617; padding: 14px; border-radius: 9px; margin: 0; white-space: pre-wrap; }
    dl { display: grid; grid-template-columns: 150px 1fr; gap: 10px; } dt { color: #94a3b8; } dd { margin: 0; }
    .description { white-space: pre-wrap; background: #020617; padding: 14px; border-radius: 9px; margin-top: 14px; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
    .image-card { display: grid; grid-template-columns: 100px 1fr; gap: 12px; background: #020617; border-radius: 9px; padding: 10px; }
    .image-card img { width: 100px; height: 100px; object-fit: contain; background: #fff; border-radius: 6px; }
    .image-card p { margin: 8px 0; } small { color: #94a3b8; }
  </style>
</head>
<body>
  <main>
    <h1>SEO Content — B1 → B6 Manual Smoke Report</h1>
    <section class="meta">
      <strong class="${summary.error ? "failure" : "success"}">${status}</strong>
      <span>Started: ${escapeHtml(summary.startedAt)}</span>
      <span>Duration: ${summary.durationMs}ms</span>
      <span>Title: ${escapeHtml(summary.input.title)}</span>
      <span>Manual niche: ${escapeHtml(summary.input.niche)}</span>
      <span>Site domain: ${escapeHtml(summary.input.siteDomain ?? "not provided")}</span>
      <span>Images: ${summary.input.imageCount}</span>
      <span>Google project: ${escapeHtml(summary.environment.googleCloudProject ?? "not configured; fallbacks may run")}</span>
      ${summary.error ? `<span class="failure">Error: ${escapeHtml(summary.error)}</span>` : ""}
    </section>
    ${renderStageCards(summary.stageTraces)}
    ${outputCard}
  </main>
</body>
</html>`;
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
  loadServerEnvironment();
  const { fixturePath, shouldOpen } = parseArguments(process.argv.slice(2));
  const repositoryRoot = process.cwd();
  const startedAt = new Date();
  const rawFixture = JSON.parse(await fs.readFile(fixturePath, "utf8")) as unknown;
  const input = parseSmokeInput(rawFixture, repositoryRoot);
  await validateLocalImageFiles(input);
  const traces: StageSnapshot[] = [];
  const pipeline = createSeoPipeline({
    siteNicheResolver: getDefaultSiteNicheResolver(),
    stages: createTracingStages(DEFAULT_SEO_PIPELINE_STAGES, (trace) => {
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
  await fs.writeFile(reportPath, renderReport(summary, artifactUrls), "utf8");
  console.log(`Report: ${reportPath}`);

  if (shouldOpen) await openReport(reportPath);
  if (error) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`Unable to start SEO Content smoke run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
