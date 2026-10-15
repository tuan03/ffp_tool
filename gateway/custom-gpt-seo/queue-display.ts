import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";

/** Preserve catalog redaction: names are enough to show progress, never checkpoint bodies. */
export function buildQueueDisplay(job: Pick<GptSeoJob, "original" | "checkpoints">): NonNullable<GptSeoJob["queueDisplay"]> {
  const source = job.original && typeof job.original === "object" && !Array.isArray(job.original)
    ? job.original as Readonly<Record<string, unknown>> : {};
  function readLabel(keys: readonly string[], maximum: number): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, maximum);
    }
    return null;
  }
  const stages = ["analysis", "research", "keywords", "submission"] as const;
  return {
    sourceTitle: readLabel(["title", "sourceTitle"], 500),
    sourceHandle: readLabel(["handle"], 250),
    checkpointStages: stages.filter(stage => Object.hasOwn(job.checkpoints, stage)),
  };
}
