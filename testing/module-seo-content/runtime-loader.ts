import { loadServerEnvironment } from "../../src/config/server-environment";
import type { SeoPipeline, SeoPipelineOptions, SeoPipelineStage } from "../../src/modules/seo-content/internal/pipeline";
import type { SiteNicheResolver } from "../../src/modules/seo-content/internal/site-niche/site-niche-resolver";

interface SmokePipelineModule {
  readonly DEFAULT_SEO_PIPELINE_STAGES: readonly SeoPipelineStage[];
  createSeoPipeline(options?: SeoPipelineOptions): SeoPipeline;
}

interface SmokeSiteNicheRuntime {
  getDefaultSiteNicheResolver(): Pick<SiteNicheResolver, "resolve">;
}

export interface SmokePipelineRuntime {
  readonly stages: readonly SeoPipelineStage[];
  readonly createSeoPipeline: SmokePipelineModule["createSeoPipeline"];
  readonly siteNicheResolver: Pick<SiteNicheResolver, "resolve">;
}

export interface SmokePipelineRuntimeDependencies {
  readonly loadEnvironment?: () => void;
  readonly loadPipelineModule?: () => Promise<SmokePipelineModule>;
  readonly loadSiteNicheRuntime?: () => Promise<SmokeSiteNicheRuntime>;
}

async function loadProductionPipelineModule(): Promise<SmokePipelineModule> {
  return import("../../src/modules/seo-content/internal/pipeline");
}

async function loadProductionSiteNicheRuntime(): Promise<SmokeSiteNicheRuntime> {
  return import("../../src/modules/seo-content/internal/site-niche/site-niche-runtime");
}

/** Loads environment before importing default stages, whose construction reads server configuration. */
export async function loadSmokePipelineRuntime(
  dependencies: SmokePipelineRuntimeDependencies = {},
): Promise<SmokePipelineRuntime> {
  const loadEnvironment = dependencies.loadEnvironment ?? loadServerEnvironment;
  const loadPipelineModule = dependencies.loadPipelineModule ?? loadProductionPipelineModule;
  const loadSiteNicheRuntime = dependencies.loadSiteNicheRuntime ?? loadProductionSiteNicheRuntime;

  loadEnvironment();
  const [pipelineModule, siteNicheRuntime] = await Promise.all([
    loadPipelineModule(),
    loadSiteNicheRuntime(),
  ]);

  return {
    stages: pipelineModule.DEFAULT_SEO_PIPELINE_STAGES,
    createSeoPipeline: pipelineModule.createSeoPipeline,
    siteNicheResolver: siteNicheRuntime.getDefaultSiteNicheResolver(),
  };
}
