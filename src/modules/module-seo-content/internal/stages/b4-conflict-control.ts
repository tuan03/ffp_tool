import { evolveContext } from "../pipeline-context";

import type {
  ConflictResult,
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";

export async function executeB4ConflictControl(
  context: SeoPipelineContext,
): Promise<SeoPipelineContext> {
  const rawKeywords = [
    ...(context.searchResearch?.seedKeywords ?? []),
    ...(context.searchResearch?.suggestedQueries ?? []),
  ];

  const approvedKeywords: string[] = [];
  const discardedKeywords: string[] = [];
  const conflictReasons: Record<string, string> = {};
  const seen = new Set<string>();

  for (const raw of rawKeywords) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      if (!discardedKeywords.includes(raw)) {
        discardedKeywords.push(raw);
      }
      conflictReasons[raw] = "duplicate";
    } else {
      seen.add(normalized);
      approvedKeywords.push(normalized);
    }
  }

  const conflictResult: ConflictResult = {
    approvedKeywords,
    discardedKeywords,
    conflictReasons,
  };

  return evolveContext(context, { conflictResult });
}

export const b4ConflictControlStage: SeoPipelineStage = {
  name: "b4",
  execute: executeB4ConflictControl,
};
