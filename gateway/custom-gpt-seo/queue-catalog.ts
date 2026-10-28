import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";

import { buildQueueDisplay } from "./queue-display";

/** Apply only after filtering/pagination. Full snapshots remain available through admin/job. */
export const QUEUE_CATALOG_PAYLOAD_SQL = `((snapshot - ARRAY['original','execution','checkpoints','result','input']) || jsonb_build_object(
  'original',jsonb_build_object('title',snapshot #> '{original,title}',
    'sourceTitle',snapshot #> '{original,sourceTitle}','handle',snapshot #> '{original,handle}'),
  'execution',(snapshot->'execution') || jsonb_build_object('originalSnapshot',null),
  'checkpoints',COALESCE((SELECT jsonb_object_agg(stage,'null'::jsonb)
    FROM jsonb_object_keys(COALESCE(snapshot->'checkpoints','{}'::jsonb)) AS stage
    WHERE stage IN ('analysis','research','keywords','submission')),'{}'::jsonb),
  'settings',(snapshot->'settings') || jsonb_build_object('instructions',''),
  'input',(snapshot->'input') || jsonb_build_object('images',
    CASE WHEN jsonb_array_length(snapshot #> '{input,images}')>0
      THEN jsonb_build_array(snapshot #> '{input,images,0}') ELSE '[]'::jsonb END)
))::text`;

export function buildQueueCatalogJob(job: GptSeoJob): GptSeoJob {
  return {
    ...job, queueDisplay: buildQueueDisplay(job), original: null,
    execution: { ...job.execution, originalSnapshot: null }, checkpoints: {}, result: undefined,
    settings: { ...job.settings, instructions: "" },
    input: { ...job.input, images: job.input.images.slice(0, 1) },
  };
}
