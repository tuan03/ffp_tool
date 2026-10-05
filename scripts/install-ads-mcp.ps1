# FFP Ads Intelligence MCP - 1-Click Client Installer
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-ads-mcp.ps1 -Token "ffp_pat_..."
# Or 1-line web install:
#   irm "https://ffp.b6-team.site/mcp/ads/install.ps1?token=ffp_pat_..." | iex

param(
  [string]$Token,
  [string]$HostUrl = "https://ffp.b6-team.site"
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

# 3. Claude Desktop Configuration (%APPDATA%\Claude\claude_desktop_config.json)
if ($env:APPDATA) {
  $claudeDir = Join-Path $env:APPDATA "Claude"
  $claudeConfig = Join-Path $claudeDir "claude_desktop_config.json"
  if (Test-Path $claudeDir) {
    try {
      $jsonObj = @{ mcpServers = @{} }
      if (Test-Path $claudeConfig) {
        $raw = Get-Content -Raw $claudeConfig -ErrorAction SilentlyContinue
        if ($raw) { $jsonObj = $raw | ConvertFrom-Json }
      }
      if (-not $jsonObj.mcpServers) {
        $jsonObj | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value @{}
      }
      Write-Host "ℹ️ Đã kiểm tra Claude Desktop config." -ForegroundColor DarkGray
    } catch {}
  }
}

Write-Host ""
Write-Host "🎉 Cài đặt hoàn tất!" -ForegroundColor Green
Write-Host "👉 Kiểm tra kết nối MCP bằng lệnh:" -ForegroundColor Cyan
Write-Host "   curl -H `"Authorization: Bearer $Token`" $mcpEndpoint" -ForegroundColor White
Write-Host ""
