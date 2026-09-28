import fs from "node:fs";
import path from "node:path";
import type http from "node:http";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serves static files from staticDir for GET/HEAD requests, with SPA fallback to index.html.
 * Returns true if the request was handled, false otherwise.
 */
export function serveStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const rawUrl = req.url || "/";
  if (rawUrl.startsWith("/api/")) {
    return false;
  }

  const resolvedStaticDir = path.resolve(staticDir);
  const parsedUrl = new URL(rawUrl, "http://localhost");
  const decodedPath = decodeURIComponent(parsedUrl.pathname);

  let targetPath = path.resolve(resolvedStaticDir, "." + decodedPath);
  if (!targetPath.startsWith(resolvedStaticDir)) {
    // Prevent path traversal
    return false;
  }

  let stat = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
  if (stat?.isDirectory()) {
    targetPath = path.join(targetPath, "index.html");
    stat = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
  }

  // SPA fallback: if file does not exist, serve index.html for frontend navigation
  if (!stat?.isFile()) {
    const indexPath = path.join(resolvedStaticDir, "index.html");
    if (fs.existsSync(indexPath)) {
      targetPath = indexPath;
      stat = fs.statSync(indexPath);
    } else {
      return false;
    }
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", stat.size);

  if (targetPath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "no-cache");
  }

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  const stream = fs.createReadStream(targetPath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    }
  });
  stream.pipe(res);
  return true;
}
