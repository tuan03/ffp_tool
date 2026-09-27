export interface CustomGptSyncGuardInput {
  readonly isApproved: boolean;
  readonly isCheckpointUnchanged: boolean;
  readonly readState: () => Promise<{ readonly status: string } | null>;
  readonly saveApproval: () => Promise<unknown>;
  readonly beginSync: () => Promise<{ readonly token: string }>;
}

/** A confirmed no-op may finish local bookkeeping after an already successful write. */
export async function acquireCustomGptSync(input: CustomGptSyncGuardInput): Promise<string | undefined> {
  if (!input.isApproved) throw new Error("External SEO sync requires an approved coordinator review");
  if (input.isCheckpointUnchanged && (await input.readState())?.status === "SYNCED") return undefined;
  await input.saveApproval();
  return (await input.beginSync()).token;
}
