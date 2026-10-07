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
  await input.saveApproval();
  return (await input.beginSync()).token;
}
