import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createAdsMcpServer } from "./mcp-server";
import { getAdsIntelligenceService } from "./service";
import type { AdsIntelligenceService } from "./service";

const MAX_MCP_REQUEST_BYTES = 1_000_000;

function matchesSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_MCP_REQUEST_BYTES) throw new Error("MCP request exceeds 1 MB");
    chunks.push(bytes);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload, null, 2));
}

export interface AdsMcpHandlerOptions {
  readonly service?: AdsIntelligenceService;
  readonly authToken?: string;
  readonly defaultStoreId?: string;
}

import { mcpUserManager } from "./mcp-users";

export function generateInstallerScript(hostUrl: string, defaultToken = ""): string {
  return `# FFP Ads Intelligence MCP - 1-Click Installer
# Run in PowerShell: irm "${hostUrl}/mcp/ads/install.ps1?token=YOUR_TOKEN" | iex
param(
  [string]$Token = "${defaultToken}",
  [string]$HostUrl = "${hostUrl}"
)

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "🚀 FFP Ads Intelligence MCP Server - 1-Click Setup" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

if (-not $Token) {
  $Token = Read-Host "👉 Vui lòng nhập Personal MCP Token (ví dụ: ffp_pat_...)"
}

if (-not $Token) {
  Write-Host "❌ Token không được để trống. Hủy cài đặt." -ForegroundColor Red
  exit 1
}

$mcpEndpoint = "$HostUrl/mcp/ads"
Write-Host "🔗 MCP Endpoint: $mcpEndpoint" -ForegroundColor Gray

# 1. Antigravity CLI (agy)
$agyCmd = Get-Command "agy" -ErrorAction SilentlyContinue
if ($agyCmd) {
  Write-Host "⚡ Phát hiện Antigravity CLI. Đang đăng ký MCP server..." -ForegroundColor Yellow
  try {
    & agy mcp remove ads-intelligence 2>$null
    & agy mcp add --header "Authorization: Bearer $Token" ads-intelligence $mcpEndpoint
    Write-Host "✅ Antigravity CLI đã cấu hình thành công!" -ForegroundColor Green
  } catch {
    Write-Host "⚠️ Không thể tự động thêm vào agy: $_" -ForegroundColor Yellow
  }
} else {
  Write-Host "ℹ️ Chưa cài đặt agy (bỏ qua)." -ForegroundColor DarkGray
}

# 2. Codex Configuration (~/.codex/config.toml)
$codexDir = Join-Path $HOME ".codex"
$codexConfig = Join-Path $codexDir "config.toml"
try {
  if (-not (Test-Path $codexDir)) {
    New-Item -ItemType Directory -Path $codexDir -Force | Out-Null
  }

  $entry = @"

[mcp_servers.ads_intelligence]
url = "$mcpEndpoint"
http_headers = { "Authorization" = "Bearer $Token" }
"@

  $existingContent = ""
  if (Test-Path $codexConfig) {
    $existingContent = Get-Content -Raw $codexConfig -ErrorAction SilentlyContinue
  }

  if ($existingContent -notmatch "\[mcp_servers\.ads_intelligence\]") {
    Add-Content -Path $codexConfig -Value $entry
    Write-Host "✅ Codex config (~/.codex/config.toml) đã được cập nhật!" -ForegroundColor Green
  } else {
    Write-Host "ℹ️ Codex config đã có cấu hình ads_intelligence." -ForegroundColor Yellow
  }
} catch {
  Write-Host "⚠️ Không thể ghi cấu hình Codex: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 Cài đặt hoàn tất!" -ForegroundColor Green
Write-Host "👉 Kiểm tra kết nối MCP bằng lệnh:" -ForegroundColor Cyan
Write-Host "   curl -H 'Authorization: Bearer $Token' $mcpEndpoint" -ForegroundColor White
Write-Host ""
`;
}

export function generateBashInstallerScript(hostUrl: string, defaultToken = ""): string {
  return `#!/usr/bin/env bash
# FFP Ads Intelligence MCP - 1-Click Installer for macOS & Linux
# Run in terminal: curl -fsSL "${hostUrl}/mcp/ads/install.sh?token=YOUR_TOKEN" | bash

set -e

TOKEN="${defaultToken}"
HOST_URL="${hostUrl}"

echo "=================================================="
echo "🚀 FFP Ads Intelligence MCP Server - 1-Click Setup"
echo "=================================================="

if [ -z "$TOKEN" ]; then
  read -r -p "👉 Vui lòng nhập Personal MCP Token (ví dụ: ffp_pat_...): " TOKEN
fi

if [ -z "$TOKEN" ]; then
  echo "❌ Token không được để trống. Hủy cài đặt."
  exit 1
fi

MCP_ENDPOINT="\${HOST_URL}/mcp/ads"
echo "🔗 MCP Endpoint: \$MCP_ENDPOINT"

# 1. Antigravity CLI (agy)
if command -v agy >/dev/null 2>&1; then
  echo "⚡ Phát hiện Antigravity CLI. Đang đăng ký MCP server..."
  agy mcp remove ads-intelligence >/dev/null 2>&1 || true
  agy mcp add --header "Authorization: Bearer \$TOKEN" ads-intelligence "\$MCP_ENDPOINT"
  echo "✅ Antigravity CLI đã cấu hình thành công!"
else
  echo "ℹ️ Chưa cài đặt agy (bỏ qua)."
fi

# 2. Codex Configuration (~/.codex/config.toml)
CODEX_DIR="\$HOME/.codex"
CODEX_CONFIG="\$CODEX_DIR/config.toml"
mkdir -p "\$CODEX_DIR"

if [ ! -f "\$CODEX_CONFIG" ] || ! grep -q "\\[mcp_servers\\.ads_intelligence\\]" "\$CODEX_CONFIG"; then
  cat <<EOF >> "\$CODEX_CONFIG"

[mcp_servers.ads_intelligence]
url = "\$MCP_ENDPOINT"
http_headers = { "Authorization" = "Bearer \$TOKEN" }
EOF
  echo "✅ Codex config (~/.codex/config.toml) đã được cập nhật!"
else
  echo "ℹ️ Codex config đã có cấu hình ads_intelligence."
fi

echo ""
echo "🎉 Cài đặt hoàn tất!"
echo "👉 Kiểm tra kết nối MCP bằng lệnh:"
echo "   curl -H \"Authorization: Bearer \$TOKEN\" \$MCP_ENDPOINT"
echo ""
`;
}

export function createAdsMcpHandler(options: AdsMcpHandlerOptions = {}) {
  const service = options.service ?? getAdsIntelligenceService();
  const configuredSecret = options.authToken || process.env.ADS_MCP_SECRET || process.env.GATEWAY_AUTH_TOKEN;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(req.url || "/", "http://localhost");
    } catch {
      parsedUrl = new URL("/", "http://localhost");
    }

    // Serve 1-Click Installer script for PowerShell if requested
    if (req.method === "GET" && parsedUrl.pathname.endsWith("/install.ps1")) {
      const host = req.headers.host || "ffp.b6-team.site";
      const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
      const proto = isLocal ? "http" : "https";
      const baseUrl = `${proto}://${host}`;
      const queryToken = parsedUrl.searchParams.get("token") || "";
      const script = generateInstallerScript(baseUrl, queryToken);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(script);
      return;
    }

    // Serve 1-Click Installer script for Bash (macOS / Linux) if requested
    if (req.method === "GET" && parsedUrl.pathname.endsWith("/install.sh")) {
      const host = req.headers.host || "ffp.b6-team.site";
      const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
      const proto = isLocal ? "http" : "https";
      const baseUrl = `${proto}://${host}`;
      const queryToken = parsedUrl.searchParams.get("token") || "";
      const script = generateBashInstallerScript(baseUrl, queryToken);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
      res.end(script);
      return;
    }

    // Info probe for GET
    if (req.method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        server: "ffp-ads-intelligence",
        version: "1.0.0",
        transport: "StreamableHTTP",
        description: "FFP Ads Intelligence MCP Server exposing performance, creative gaps, brief studio, and experiment ledger tools for Codex & AI agents.",
        endpoints: {
          mcpStreamableHttp: parsedUrl.pathname || "/mcp/ads",
          installerScript: "/mcp/ads/install.ps1",
          openApiSpec: "/api/ads-intelligence/openapi.json",
        },
        toolsCount: 37,
      });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed. Use POST for JSON-RPC 2.0 or GET for server info." },
        id: null,
      });
      return;
    }

    // Authentication & Identity Resolution
    const authHeader = req.headers.authorization;
    const bearer =
      (authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : undefined) ||
      (req.headers["x-gateway-key"] as string | undefined) ||
      parsedUrl.searchParams.get("token") ||
      undefined;

    let currentUser: { name: string; token: string; allowedStores: readonly string[] } = {
      name: "Direct Caller",
      token: "direct",
      allowedStores: ["*"],
    };

    const hasUsers = mcpUserManager.listUsers().length > 0;
    const isAuthRequired = Boolean(configuredSecret || hasUsers);

    if (isAuthRequired) {
      if (!bearer) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="ffp-ads-mcp"');
        sendJson(res, 401, {
          jsonrpc: "2.0",
          error: { code: -32001, message: "Invalid or missing MCP authorization credentials." },
          id: null,
        });
        return;
      }

      if (configuredSecret && matchesSecret(bearer, configuredSecret)) {
        currentUser = {
          name: "Super Admin",
          token: bearer,
          allowedStores: ["*"],
        };
      } else {
        const user = mcpUserManager.findUserByToken(bearer);
        if (user && user.status === "ACTIVE") {
          currentUser = {
            name: user.name,
            token: user.token,
            allowedStores: user.allowedStores,
          };
        } else {
          res.setHeader("WWW-Authenticate", 'Bearer realm="ffp-ads-mcp"');
          sendJson(res, 401, {
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: user && user.status === "REVOKED"
                ? "This MCP token has been revoked by an administrator."
                : "Invalid or missing MCP authorization credentials.",
            },
            id: null,
          });
          return;
        }
      }
    } else if (bearer) {
      if (configuredSecret && matchesSecret(bearer, configuredSecret)) {
        currentUser = { name: "Super Admin", token: bearer, allowedStores: ["*"] };
      } else {
        const user = mcpUserManager.findUserByToken(bearer);
        if (user && user.status === "ACTIVE") {
          currentUser = { name: user.name, token: user.token, allowedStores: user.allowedStores };
        }
      }
    }

    // Extract storeId if passed as query parameter
    let storeId = options.defaultStoreId || "chillgen";
    const storeParam = parsedUrl.searchParams.get("storeId");
    if (storeParam) {
      storeId = storeParam;
    }

    const server = createAdsMcpServer({
      service,
      defaultStoreId: storeId,
      userToken: currentUser.token,
      userName: currentUser.name,
      allowedStores: currentUser.allowedStores,
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      const body = await readJson(req);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, error instanceof SyntaxError ? 400 : 500, {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof SyntaxError ? "Invalid JSON" : "Internal MCP server error",
          },
          id: null,
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  };
}

let cachedHandler: ReturnType<typeof createAdsMcpHandler> | null = null;

export async function handleAdsMcpHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!cachedHandler) {
    cachedHandler = createAdsMcpHandler();
  }
  await cachedHandler(req, res);
}
