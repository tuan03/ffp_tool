import { GatewayError } from "./errors";

export interface ChunkedWriteOptions<TItem, TChunkResult> {
  readonly items: readonly TItem[];
  readonly chunkSize: number;
  readonly operationName: string;
  readonly executeChunk: (chunk: readonly TItem[], chunkIndex: number) => Promise<TChunkResult>;
  readonly extractCompletedDetails: (completedResults: readonly TChunkResult[]) => Record<string, unknown>;
}

export interface ChunkedWriteOutput<TChunkResult> {
  readonly chunkResults: readonly TChunkResult[];
  readonly completedChunks: number;
  readonly totalChunks: number;
}

/**
 * Generic helper for executing multi-chunk mutations with strict partial-write protection.
 *
 * Rules:
 * - Case A (chunkIndex === 0 fails): No prior mutations succeeded. Rethrows original error as-is.
 * - Case B (chunkIndex > 0 fails with user/application error): Prior mutations succeeded.
 *   Throws SHOPIFY_PARTIAL_WRITE with reconciliationRequired: true and details of completed IDs/keys.
 * - Case C (chunkIndex > 0 fails with ambiguous network/timeout error): Prior mutations succeeded.
 *   Throws SHOPIFY_PARTIAL_WRITE with reconciliationRequired: true, causeCode: SHOPIFY_UNKNOWN_WRITE_STATE,
 *   and ambiguousChunkIndex.
 */
export async function executeChunkedWrite<TItem, TChunkResult>(
  options: ChunkedWriteOptions<TItem, TChunkResult>,
): Promise<ChunkedWriteOutput<TChunkResult>> {
  const { items, chunkSize, operationName, executeChunk, extractCompletedDetails } = options;

  if (items.length === 0) {
    return {
      chunkResults: [],
      completedChunks: 0,
      totalChunks: 0,
    };
  }

  const completedResults: TChunkResult[] = [];
  const totalChunks = Math.ceil(items.length / chunkSize);

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunkIndex = Math.floor(i / chunkSize);
    const chunk = items.slice(i, i + chunkSize);

    try {
      const chunkResult = await executeChunk(chunk, chunkIndex);
      completedResults.push(chunkResult);
    } catch (err: unknown) {
      if (completedResults.length === 0) {
        // Case A: First chunk failed. No mutations have persisted on Shopify.
        throw err;
      }

      // Case B & C: At least 1 chunk succeeded, but a subsequent chunk failed.
      const causeCode =
        err instanceof GatewayError
          ? err.code
          : err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
          ? ((err as { code: string }).code)
          : "UNKNOWN_ERROR";

      const isAmbiguous = causeCode === "SHOPIFY_UNKNOWN_WRITE_STATE";
      const errMsg = err instanceof Error ? err.message : String(err);
      const completedDetails = extractCompletedDetails(completedResults);
      const errDetails = err instanceof GatewayError && err.details ? err.details : {};

      const mergedDetails: Record<string, unknown> = { ...completedDetails };
      for (const [key, val] of Object.entries(errDetails)) {
        if (Array.isArray(val) && Array.isArray(mergedDetails[key])) {
          mergedDetails[key] = [...(mergedDetails[key] as unknown[]), ...val];
        } else if (typeof val === "number" && typeof mergedDetails[key] === "number" && key.endsWith("Count")) {
          mergedDetails[key] = (mergedDetails[key] as number) + val;
        } else {
          mergedDetails[key] = val;
        }
      }

      const partialDetails: Record<string, unknown> = {
        ...mergedDetails,
        operationName,
        completedChunks: completedResults.length,
        totalChunks,
        failedChunkIndex: chunkIndex,
        causeCode,
        ...(isAmbiguous ? { ambiguousChunkIndex: chunkIndex } : {}),
        reconciliationRequired: true,
      };

      throw new GatewayError(
        `${operationName} partially written (${completedResults.length}/${totalChunks} chunks succeeded), but chunk ${chunkIndex} failed: ${errMsg}`,
        "SHOPIFY_PARTIAL_WRITE",
        409,
        undefined,
        err,
        err instanceof GatewayError ? err.fields : undefined,
        false,
        partialDetails,
        true,
      );
    }
  }

  return {
    chunkResults: completedResults,
    completedChunks: completedResults.length,
    totalChunks,
  };
}
