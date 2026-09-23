import type { PinterestPodDeliverables, PodDeliverableItem } from "../pinterest-pod";
import { runPinterestPodSeoPipeline } from "../seo-content";
import type {
  PinterestPodSeoBatchResult,
  PinterestPodSeoItemResult,
  PinterestPodSeoOptions,
  SeoContentInput,
  SeoContentOutput,
} from "../seo-content";

export type { PinterestPodDeliverables, PodDeliverableItem };

export interface HandoverPinterestToSeoInput {
  readonly workflowId?: string;
  readonly deliverables: PinterestPodDeliverables | readonly PodDeliverableItem[];
  readonly defaultNiche?: string;
  readonly concurrency?: number;
}

export interface HandoverPinterestToSeoDependencies {
  readonly seoRunner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
}

export interface HandoverPinterestToSeoResult {
  readonly workflowId: string;
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  readonly items: readonly PinterestPodSeoItemResult[];
  readonly seoOutputs: readonly SeoContentOutput[];
}

/**
 * Coordinates data processing from Pinterest POD Studio deliverables through the SEO Content Pipeline (B1 -> B6).
 */
export async function handoverPinterestToSeo(
  input: HandoverPinterestToSeoInput,
  dependencies: HandoverPinterestToSeoDependencies = {},
): Promise<HandoverPinterestToSeoResult> {
  const deliverables = input.deliverables;
  const rawWorkflowId = !Array.isArray(deliverables) && deliverables && "workflowId" in deliverables
    ? deliverables.workflowId
    : undefined;
  const workflowId = input.workflowId || rawWorkflowId || `pinterest-pod-handover-${Date.now()}`;

  const items = Array.isArray(deliverables)
    ? deliverables
    : (deliverables as PinterestPodDeliverables)?.items ?? [];

  if (items.length === 0) {
    return {
      workflowId,
      total: 0,
      successful: 0,
      failed: 0,
      items: [],
      seoOutputs: [],
    };
  }

  const seoOptions: PinterestPodSeoOptions = {
    runner: dependencies.seoRunner,
    defaultNiche: input.defaultNiche || "home decor",
    concurrency: input.concurrency || 3,
  };

  const batchResult: PinterestPodSeoBatchResult = await runPinterestPodSeoPipeline(
    deliverables,
    seoOptions,
  );

  return {
    workflowId,
    total: batchResult.total,
    successful: batchResult.successful,
    failed: batchResult.failed,
    items: batchResult.items,
    seoOutputs: batchResult.seoOutputs,
  };
}
