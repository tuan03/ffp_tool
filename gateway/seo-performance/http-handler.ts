import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import { isGatewayAuthorized } from "../http-server";
import type { PerformanceService } from "./service";
import { filtersSchema } from "./service";

function send(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > 50000) throw new Error("REQUEST_TOO_LARGE"); chunks.push(bytes); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown : {};
}
export async function handlePerformanceHttp(req: IncomingMessage, res: ServerResponse, options: { readonly service?: PerformanceService; readonly authToken?: string; readonly hasStore: (storeId: string) => boolean | Promise<boolean> }): Promise<void> {
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!options.authToken || !isGatewayAuthorized(req.headers, options.authToken)) { send(res, 401, { error: { code: "UNAUTHORIZED", message: "Đăng nhập quản trị để sử dụng SEO Performance." } }); return; }
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = url.pathname.replace(/^\/api\/seo-performance\//, "");
  if (!["GET", "POST"].includes(req.method ?? "")) { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
  if (req.method === "POST" && req.headers["x-ffp-performance"] !== "1") { send(res, 403, { error: { code: "CSRF_CHECK_FAILED" } }); return; }
  const session = req.headers.authorization ?? String(req.headers["x-gateway-key"] ?? "");
  const service = options.service;
  if (!service) { send(res, 503, { error: { code: "SEO_PERFORMANCE_DISABLED", message: "SEO Performance chưa được bật hoặc chưa cấu hình PostgreSQL." } }); return; }
  try {
    await service.ready();
    if (route === "oauth/callback" && req.method === "GET") {
      const cookie = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("ffp_gsc_oauth="))?.slice("ffp_gsc_oauth=".length) ?? "";
      await service.google.callback({ state: z.string().min(10).max(200).parse(url.searchParams.get("state")), code: z.string().min(1).max(4000).parse(url.searchParams.get("code")), session, cookie });
      res.setHeader("Set-Cookie", "ffp_gsc_oauth=; Path=/api/seo-performance/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
      res.setHeader("Referrer-Policy", "no-referrer"); res.writeHead(303, { Location: "/seo-performance" }); res.end(); return;
    }
    if (route === "oauth/start" && req.method === "POST") {
      const connection = await service.google.connect(session);
      res.setHeader("Set-Cookie", `ffp_gsc_oauth=${connection.cookie}; Path=/api/seo-performance/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
      send(res, 200, { url: connection.url }); return;
    }
    if (route === "disconnect" && req.method === "POST") { await service.google.disconnect(); send(res, 200, { ok: true }); return; }
    if (route === "properties" && req.method === "GET") { send(res, 200, await service.google.properties()); return; }
    const storeId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(url.searchParams.get("storeId"));
    if (!await options.hasStore(storeId)) { send(res, 404, { error: { code: "STORE_NOT_FOUND" } }); return; }
    const filters = filtersSchema.parse(Object.fromEntries([...url.searchParams].filter(([key]) => key !== "storeId" && key !== "url")));
    if (req.method === "GET") {
      switch (route) {
        case "overview": send(res, 200, await service.overview(storeId, filters)); return;
        case "pages": send(res, 200, await service.repository.pages(storeId, filters)); return;
        case "queries": send(res, 200, await service.repository.queries(storeId, z.string().url().parse(url.searchParams.get("url")), filters)); return;
        case "evidence": send(res, 200, await service.evidence(storeId, z.string().url().parse(url.searchParams.get("url")))); return;
        case "recommendations": send(res, 200, await service.repository.recommendations(storeId, filters.offset)); return;
        case "history": send(res, 200, await service.repository.history(storeId, filters.offset)); return;
      }
    } else {
      const payload = await body(req);
      switch (route) {
        case "mapping": { const input = z.object({ property: z.string().min(1).max(2000), origin: z.string().url(), confirmed: z.literal(true) }).strict().parse(payload); await service.map(storeId, input.property, input.origin); send(res, 200, { ok: true }); return; }
        case "jobs": { const input = z.object({ kind: z.enum(["sync", "crawl"]) }).strict().parse(payload); send(res, 202, await service.start(storeId, input.kind)); return; }
        case "inspection": { const input = z.object({ url: z.string().url() }).strict().parse(payload); send(res, 202, await service.inspect(storeId, input.url)); return; }
        case "revise": { const input = z.object({ recommendationId: z.string().uuid() }).strict().parse(payload); send(res, 202, await service.revise(storeId, input.recommendationId, "operator")); return; }
        case "dismiss": { const input = z.object({ recommendationId: z.string().uuid() }).strict().parse(payload); await service.dismiss(storeId, input.recommendationId, "operator"); send(res, 200, { ok: true }); return; }
      }
    }
    send(res, 404, { error: { code: "NOT_FOUND" } });
  } catch (error) {
    const code = error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REQUEST" : error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : "SEO_PERFORMANCE_UNAVAILABLE";
    send(res, code === "SEO_PERFORMANCE_UNAVAILABLE" ? 503 : 400, { error: { code, message: `Không thể hoàn thành thao tác (${code}). Kiểm tra cấu hình hoặc làm mới dữ liệu trước khi thử lại.` } });
  }
}
