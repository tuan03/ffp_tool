export interface CustomGptSyncGuardInput {
  readonly isApproved: boolean;
  readonly isCheckpointUnchanged: boolean;
  readonly isExplicitReconciliation?: boolean;
  readonly readState: () => Promise<{ readonly token?: string; readonly status: string } | null>;
  readonly saveApproval: () => Promise<unknown>;
  readonly beginSync: () => Promise<{ readonly token: string }>;
}

/** A confirmed no-op may finish local bookkeeping after an already successful write. */
export async function acquireCustomGptSync(input: CustomGptSyncGuardInput): Promise<string | undefined> {
  if (!input.isApproved) throw new Error("External SEO sync requires an approved coordinator review");
  const state = await input.readState();
  if (input.isCheckpointUnchanged && state?.status === "SYNCED") return undefined;
  if (
    input.isExplicitReconciliation
    && state?.token
    && ["SYNCING", "UNKNOWN"].includes(state.status)
  ) {
    return state.token;
  }
  if (state && ["SYNCING", "UNKNOWN", "SYNCED"].includes(state.status)) {
    throw new Error("SYNC_RECONCILIATION_REQUIRED: existing Shopify operation requires reconciliation");
  }
  await input.saveApproval();
  return (await input.beginSync()).token;
}

/** Return true whenever a failed attempt still needs reconciliation, including release failure. */
export async function finishFailedCustomGptSync(input: {
  readonly hasStartedWrite: boolean;
  readonly hasUnresolvedPriorWrite: boolean;
  readonly finishSync: (status: "UNKNOWN" | "NOT_STARTED") => Promise<unknown>;
}): Promise<boolean> {
  const isUncertain = input.hasStartedWrite || input.hasUnresolvedPriorWrite;
  try {
    await input.finishSync(isUncertain ? "UNKNOWN" : "NOT_STARTED");
    return isUncertain;
  } catch {
    // No proof of release: keep the caller fenced rather than offer a normal retry.
    return true;
  }
}
