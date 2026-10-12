import { z } from "zod";

import { SHOPIFY_ASIN_FILTER_LIMIT } from "../types";
import type { ShopifyAsinFilterResult } from "../types";

export interface AsinFilterSnapshot {
  readonly inputText: string;
  readonly checkedAt: string;
  readonly result: ShopifyAsinFilterResult;
}

export interface AsinFilterWorkspace {
  readonly inputText: string;
  readonly snapshot: AsinFilterSnapshot | null;
  readonly progress?: {
    readonly rows: Readonly<Record<string, { readonly copied?: boolean; readonly viewed?: boolean; readonly selected?: boolean }>>;
    readonly lastAsin?: string;
  };
}

const asinSchema = z.string().regex(/^[A-Z0-9]{10}$/);
const workspaceSchema = z.object({
  inputText: z.string().max(500000),
  progress: z.object({
    rows: z.record(asinSchema, z.object({ copied: z.boolean().optional(), viewed: z.boolean().optional(), selected: z.boolean().optional() }))
      .refine((rows) => Object.keys(rows).length <= SHOPIFY_ASIN_FILTER_LIMIT),
    lastAsin: asinSchema.optional(),
  }).optional(),
  snapshot: z.object({
    inputText: z.string().max(500000),
    checkedAt: z.iso.datetime(),
    result: z.object({
      storeId: z.string(),
      missingAsins: z.array(asinSchema).max(SHOPIFY_ASIN_FILTER_LIMIT),
      matches: z.array(z.object({
        asin: asinSchema, productId: z.string(), title: z.string(), status: z.string(),
        adminUrl: z.url().refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password && url.hostname.endsWith(".myshopify.com");
        }),
      })).max(SHOPIFY_ASIN_FILTER_LIMIT),
      scannedProducts: z.number().int().nonnegative(),
    }),
  }).nullable(),
});

function storageKey(storeId: string): string {
  return `ffp:crawler:asin-filter:v1:${encodeURIComponent(storeId)}`;
}

export function retainAsinFilterProgress(workspace: AsinFilterWorkspace): AsinFilterWorkspace {
  if (!workspace.progress) return workspace;
  const missing = new Set(workspace.snapshot?.result.missingAsins ?? []);
  const rows = Object.fromEntries(Object.entries(workspace.progress.rows).filter(([asin]) => missing.has(asin)));
  const lastAsin = workspace.progress.lastAsin;
  return { ...workspace, progress: { rows, ...(lastAsin && missing.has(lastAsin) ? { lastAsin } : {}) } };
}

export function markAsinFilterRow(workspace: AsinFilterWorkspace, asin: string, action: "copied" | "viewed" | "selected"): AsinFilterWorkspace {
  if (!workspace.snapshot?.result.missingAsins.includes(asin)) return workspace;
  const retained = retainAsinFilterProgress(workspace);
  return { ...retained, progress: {
    rows: { ...retained.progress?.rows, [asin]: { ...retained.progress?.rows[asin], [action]: true } },
    lastAsin: asin,
  } };
}

export function readAsinFilterWorkspace(storage: Pick<Storage, "getItem">, storeId: string): AsinFilterWorkspace {
  try {
    const serialized = storage.getItem(storageKey(storeId));
    const parsed = workspaceSchema.safeParse(serialized ? JSON.parse(serialized) : null);
    if (parsed.success) {
      const snapshot = parsed.data.snapshot?.result.storeId === storeId ? parsed.data.snapshot : null;
      return retainAsinFilterProgress({ inputText: parsed.data.inputText, snapshot,
        ...(snapshot && parsed.data.progress ? { progress: parsed.data.progress } : {}),
      });
    }
  } catch { /* Blocked browser storage must not prevent using the filter. */ }
  return { inputText: "", snapshot: null };
}

export function writeAsinFilterWorkspace(storage: Pick<Storage, "setItem" | "removeItem">, storeId: string, workspace: AsinFilterWorkspace): boolean {
  try {
    if (!workspace.inputText && !workspace.snapshot) storage.removeItem(storageKey(storeId));
    else storage.setItem(storageKey(storeId), JSON.stringify(workspace));
    return true;
  } catch { return false; }
}
