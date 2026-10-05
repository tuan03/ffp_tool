import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import type { ObserveSeoProductResult } from "./baseline-service";
import { diffSeoSnapshots } from "./diff";
import type { SeoVersionRepository } from "./repository";

export interface SeoVersionHttpDependencies {
  readonly repository: () => Promise<SeoVersionRepository>;
  readonly observeProduct?: (storeId: string, productGid: string) => Promise<ObserveSeoProductResult>;
  readonly isPublishEnabled?: boolean;
  readonly now?: () => number;
}

const productGidSchema = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/).max(200);

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 8192) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function action(enabled: boolean, reasonCode: string | null = null) {
  return { enabled, reasonCode: enabled ? null : reasonCode };
}

function errorCode(error: unknown): string {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return "INVALID_REQUEST";
  const message = error instanceof Error ? error.message : "";
  const safe = new Set([
    "REQUEST_TOO_LARGE", "SEO_VERSION_READ_DISABLED", "SEO_VERSION_WRITE_DISABLED", "SEO_VERSION_READ_REQUIRED",
    "SEO_PRODUCT_NOT_FOUND", "SEO_VERSION_NOT_FOUND", "SEO_SNAPSHOT_NOT_FOUND", "SEO_BASELINE_REQUIRED",
    "SEO_PRODUCT_DIRTY", "ROLLBACK_TARGET_CURRENT", "ROLLBACK_REQUEST_CONFLICT", "INVALID_PAGINATION",
  ]);
  return safe.has(message) ? message : "SEO_VERSIONING_UNAVAILABLE";
}

function statusFor(code: string): number {
  if (code === "REQUEST_TOO_LARGE") return 413;
  if (code === "SEO_PRODUCT_NOT_FOUND" || code === "SEO_VERSION_NOT_FOUND" || code === "SEO_SNAPSHOT_NOT_FOUND") return 404;
  if (["SEO_VERSION_READ_DISABLED", "SEO_VERSION_WRITE_DISABLED", "SEO_PRODUCT_DIRTY", "ROLLBACK_TARGET_CURRENT", "ROLLBACK_REQUEST_CONFLICT"].includes(code)) return 409;
  return code === "SEO_VERSIONING_UNAVAILABLE" ? 503 : 400;
}

/** Handles an already authenticated and store-authorized versioning request. */
export async function handleSeoVersionHttp(req: IncomingMessage, res: ServerResponse, input: {
  readonly url: URL;
  readonly storeId: string;
  readonly operator: string;
  readonly dependencies: SeoVersionHttpDependencies;
}): Promise<boolean> {
  if (!input.url.pathname.startsWith("/api/seo-agent/versioning/")) return false;
  try {
    const repository = await input.dependencies.repository();
    const productGid = req.method === "GET" ? productGidSchema.parse(input.url.searchParams.get("productGid")) : null;
    if (input.url.pathname.endsWith("/lifecycle") && req.method === "GET") {
      const flags = await repository.getStoreFlags(input.storeId);
      if (!flags.readEnabled) {
        send(res, 200, { flags, current: null, capabilities: {
          baselineRefresh: action(false, "SEO_VERSION_READ_DISABLED"), rollbackDraft: action(false, "SEO_VERSION_READ_DISABLED"),
          publish: action(false, "SEO_VERSION_READ_DISABLED"), reconcile: action(false, "SEO_VERSION_READ_DISABLED"),
        } });
        return true;
      }
      const current = await repository.getProductLifecycle(input.storeId, productGid as string);
      const clean = current.state !== "DIRTY";
      send(res, 200, { flags, current, capabilities: {
        baselineRefresh: action(Boolean(input.dependencies.observeProduct), "BASELINE_REFRESH_UNAVAILABLE"),
        rollbackDraft: action(flags.writeEnabled && clean, !flags.writeEnabled ? "SEO_VERSION_WRITE_DISABLED" : "SEO_PRODUCT_DIRTY"),
        publish: action(Boolean(input.dependencies.isPublishEnabled) && flags.writeEnabled && clean,
          !flags.writeEnabled ? "SEO_VERSION_WRITE_DISABLED" : !clean ? "SEO_PRODUCT_DIRTY" : "PUBLISH_DISABLED"),
        reconcile: action(Boolean(input.dependencies.isPublishEnabled), "PUBLISH_DISABLED"),
      } });
      return true;
    }
    if (input.url.pathname.endsWith("/history") && req.method === "GET") {
      const limit = z.coerce.number().int().min(1).max(100).parse(input.url.searchParams.get("limit") ?? 25);
      const offset = z.coerce.number().int().min(0).max(1_000_000).parse(input.url.searchParams.get("offset") ?? 0);
      send(res, 200, await repository.listVersionPage(input.storeId, productGid as string, limit, offset));
      return true;
    }
    if (input.url.pathname.endsWith("/diff") && req.method === "GET") {
      const fromVersionId = z.string().min(1).max(200).parse(input.url.searchParams.get("fromVersionId"));
      const toVersionId = z.string().min(1).max(200).parse(input.url.searchParams.get("toVersionId"));
      const [from, to] = await Promise.all([
        repository.getVersionSnapshot(input.storeId, productGid as string, fromVersionId),
        repository.getVersionSnapshot(input.storeId, productGid as string, toVersionId),
      ]);
      send(res, 200, { fromVersion: from.version, toVersion: to.version, ...diffSeoSnapshots(from.snapshot, to.snapshot) });
      return true;
    }
    if (input.url.pathname.endsWith("/baseline") && req.method === "POST") {
      if (!input.dependencies.observeProduct) { send(res, 503, { error: { code: "BASELINE_REFRESH_UNAVAILABLE" } }); return true; }
      const body = z.object({ productGid: productGidSchema }).strict().parse(await readBody(req));
      send(res, 202, await input.dependencies.observeProduct(input.storeId, body.productGid));
      return true;
    }
    if (input.url.pathname.endsWith("/rollback-drafts") && req.method === "POST") {
      const body = z.object({ productGid: productGidSchema, targetVersionId: z.string().min(1).max(200), requestId: z.string().uuid() }).strict().parse(await readBody(req));
      const result = await repository.requestRollbackDraft({ storeId: input.storeId, shopifyProductGid: body.productGid,
        targetVersionId: body.targetVersionId, requestId: body.requestId, requestedBy: input.operator,
        createdAt: (input.dependencies.now ?? Date.now)() });
      send(res, 201, result);
      return true;
    }
    send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
    return true;
  } catch (error) {
    const code = errorCode(error);
    send(res, statusFor(code), { error: { code } });
    return true;
  }
}
