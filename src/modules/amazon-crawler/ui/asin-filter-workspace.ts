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
}

const asinSchema = z.string().regex(/^[A-Z0-9]{10}$/);
const workspaceSchema = z.object({
  inputText: z.string().max(500000),
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

export function readAsinFilterWorkspace(storage: Pick<Storage, "getItem">, storeId: string): AsinFilterWorkspace {
  try {
    const serialized = storage.getItem(storageKey(storeId));
    const parsed = workspaceSchema.safeParse(serialized ? JSON.parse(serialized) : null);
    if (parsed.success) return { inputText: parsed.data.inputText, snapshot: parsed.data.snapshot?.result.storeId === storeId ? parsed.data.snapshot : null };
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
