# ==============================================================================
# FFP Tool - 1-Command Crawler Agent Installer (Windows PowerShell)
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-agent.ps1
#   Or remote one-liner:
#   irm https://ffp.b6-team.site/install-agent.ps1 | iex
# ==============================================================================

param(
    [string]$ServerUrl = "https://ffp.b6-team.site",
    [string]$DisplayName = $env:COMPUTERNAME,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       FFP CRAWLER AGENT - CAI DAT 1 LENH DUY NHAT        " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir -or $ScriptDir -eq "") {
    $ScriptDir = (Get-Location).Path
}

# Resolve project / agent root directory
$AgentRoot = $ScriptDir
if (Test-Path (Join-Path $ScriptDir "..\src\modules\amazon-crawler")) {
    $AgentRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
}
Set-Location $AgentRoot
Write-Host "-> Thu muc cai dat: $AgentRoot" -ForegroundColor Gray

# 1. Kiem tra Python
Write-Host "[1/5] Kiem tra moi truong Python..." -ForegroundColor Green
$PythonCmd = $null
if (Get-Command "python" -ErrorAction SilentlyContinue) {
    $ver = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
    if ($ver -and [version]$ver -ge [version]"3.10") {
        $PythonCmd = "python"
        Write-Host "  Found Python $ver (OK)" -ForegroundColor Gray
    }
}

if (-not $PythonCmd -and (Get-Command "python3" -ErrorAction SilentlyContinue)) {
    $ver = python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
    if ($ver -and [version]$ver -ge [version]"3.10") {
        $PythonCmd = "python3"
        Write-Host "  Found Python3 $ver (OK)" -ForegroundColor Gray
    }
}

if (-not $PythonCmd) {
    Write-Host "  Khong tim thay Python >= 3.10! Dang thu cai dat tu dong qua winget..." -ForegroundColor Yellow
    if (Get-Command "winget" -ErrorAction SilentlyContinue) {
        Write-Host "  Dang chay winget install Python.Python.3.11..." -ForegroundColor Gray
        winget install -e --id Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $PythonCmd = "python"
    } else {
        Write-Host "  LOI: Vui long cai dat Python 3.10 hoac 3.11 tu https://www.python.org/downloads/ va tick chon 'Add Python to PATH'." -ForegroundColor Red
        exit 1
    }
}

# 2. Tao Virtual Environment
$VenvDir = Join-Path $AgentRoot ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
Write-Host "[2/5] Thiet lap moi truong ao (.venv)..." -ForegroundColor Green
if (-not (Test-Path $VenvPython)) {
    Write-Host "  Dang tao .venv moi..." -ForegroundColor Gray
    & $PythonCmd -m venv $VenvDir
} else {
    Write-Host "  .venv da ton tai, su dung san co." -ForegroundColor Gray
}

# 3. Cai dat dependencies
Write-Host "[3/5] Dang cai dat thu vien phan mem can thiet..." -ForegroundColor Green
& $VenvPython -m pip install --disable-pip-version-check --upgrade pip | Out-Null

$ReqPath = Join-Path $AgentRoot "src\modules\amazon-crawler\engine\requirements.txt"
if (Test-Path $ReqPath) {
    & $VenvPython -m pip install -r $ReqPath
} else {
    & $VenvPython -m pip install "playwright>=1.50,<2" "fastapi==0.116.1" "uvicorn[standard]==0.35.0" "beautifulsoup4>=4.12,<5" "python-dotenv>=1,<2" "websockets>=15,<16" "pillow>=11,<12" "pystray>=0.19,<1" "httpx>=0.27.0" "numpy>=1.26,<3" "requests>=2.31,<3"
}

# 4. Cai dat Playwright Browser (Chromium)
Write-Host "[4/5] Cai dat trinh duyet Chromium cho crawler..." -ForegroundColor Green
& $VenvPython -m playwright install chromium

# 5. Cau hinh Agent
Write-Host "[5/5] Khoi tao cau hinh agent.json..." -ForegroundColor Green
$ConfigDir = Join-Path $AgentRoot "config"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$ConfigFile = Join-Path $ConfigDir "amazon-crawler-agent.json"

if (-not (Test-Path $ConfigFile)) {
    $DefaultConfig = @{
        serverUrl = $ServerUrl
        displayName = "$DisplayName"
        dataDirectory = ".runtime/agent-data"
        heartbeatIntervalSeconds = 10
    } | ConvertTo-Json -Depth 4
    Set-Content -Path $ConfigFile -Value $DefaultConfig -Encoding UTF8
    Write-Host "  Tao file cau hinh: $ConfigFile" -ForegroundColor Gray
} else {
    Write-Host "  File cau hinh da ton tai, giu nguyen: $ConfigFile" -ForegroundColor Gray
}

# Tao launcher chay nhanh
$BatLauncher = Join-Path $AgentRoot "chay-agent.bat"
$BatContent = @"
@echo off
title FFP Crawler Agent
cd /d "%~dp0"
echo ===================================================
echo     DANG KHOI CHAY FFP CRAWLER AGENT
echo ===================================================
call .venv\Scripts\activate.bat
python scripts\amazon-crawler-agent.py --project-root .
pause
"@
Set-Content -Path $BatLauncher -Value $BatContent -Encoding ASCII
Write-Host "  Tao file chay nhanh: chay-agent.bat" -ForegroundColor Gray

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " CAI DAT HOAN TAT THANH CONG!                             " -ForegroundColor Green
Write-Host " Server: $ServerUrl                                       " -ForegroundColor Cyan
Write-Host " Chay lai bat cu luc nao bang: chay-agent.bat             " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""

if (-not $NoStart) {
    Write-Host "Dang khoi chay Crawler Agent..." -ForegroundColor Cyan
    & $VenvPython (Join-Path $AgentRoot "scripts\amazon-crawler-agent.py") --project-root $AgentRoot
}
