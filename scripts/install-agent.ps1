# ==============================================================================
# FFP Tool - Remote Crawler Agent Installer (Windows PowerShell)
#
# Internet:
#   irm https://ffp.b6-team.site/install-agent.ps1 | iex
# Local network:
#   $env:FFP_SERVER_URL="http://192.168.1.10:3010"; irm "$env:FFP_SERVER_URL/install-agent.ps1" | iex
# ==============================================================================

param(
    [string]$ServerUrl = $(if ($env:FFP_SERVER_URL) { $env:FFP_SERVER_URL } else { "https://ffp.b6-team.site" }),
    [string]$DisplayName = $env:COMPUTERNAME,
    [string]$InstallDirectory = "",
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$ServerUrl = $ServerUrl.Trim().TrimEnd("/")
$serverUri = [Uri]$ServerUrl
if (-not $serverUri.IsAbsoluteUri -or $serverUri.Scheme -notin @("http", "https")) {
    throw "ServerUrl must be an absolute HTTP(S) URL."
}
if (-not [string]::IsNullOrEmpty($serverUri.UserInfo) -or -not [string]::IsNullOrEmpty($serverUri.Query) -or -not [string]::IsNullOrEmpty($serverUri.Fragment)) {
    throw "ServerUrl must not contain credentials, query parameters, or fragments."
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       FFP CRAWLER AGENT - REMOTE INSTALLER              " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$invocationPath = $MyInvocation.MyCommand.Path
$scriptDirectory = if ($invocationPath) { Split-Path -Parent $invocationPath } else { "" }
$repositoryRoot = if ($scriptDirectory -and (Test-Path -LiteralPath (Join-Path $scriptDirectory "..\src\modules\amazon-crawler\engine"))) {
    (Resolve-Path -LiteralPath (Join-Path $scriptDirectory "..")).Path
} else {
    ""
}

if ($InstallDirectory.Trim()) {
    $AgentRoot = [IO.Path]::GetFullPath($InstallDirectory)
} elseif ($repositoryRoot) {
    $AgentRoot = $repositoryRoot
} else {
    $localBase = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $HOME }
    $AgentRoot = Join-Path $localBase "FFP\CrawlerAgent"
}
New-Item -ItemType Directory -Force -Path $AgentRoot | Out-Null
Write-Host "-> Thu muc cai dat: $AgentRoot" -ForegroundColor Gray
Write-Host "-> May chu: $ServerUrl" -ForegroundColor Gray

Write-Host "[1/6] Kiem tra Python >= 3.10..." -ForegroundColor Green
$PythonCmd = $null
foreach ($candidate in @("python", "python3")) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $version = & $candidate -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($version -and [version]$version -ge [version]"3.10") {
            $PythonCmd = $candidate
            Write-Host "  Found Python $version (OK)" -ForegroundColor Gray
            break
        }
    }
}

if (-not $PythonCmd) {
    if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
        throw "Khong tim thay Python >= 3.10 va winget. Hay cai Python 3.11 tu https://www.python.org/downloads/."
    }
    Write-Host "  Dang cai dat Python 3.11 bang winget..." -ForegroundColor Yellow
    winget install -e --id Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    $python311 = Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe"
    $PythonCmd = if (Test-Path -LiteralPath $python311) { $python311 } else { "python" }
    & $PythonCmd -c "import sys; assert sys.version_info >= (3, 10)"
}

if (-not $repositoryRoot) {
    Write-Host "[2/6] Tai day du ma nguon Agent..." -ForegroundColor Green
    $temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("ffp-agent-" + [Guid]::NewGuid().ToString("N"))
    $archivePath = Join-Path $temporaryRoot "ffp-crawler-agent.tar.gz"
    $checksumPath = "$archivePath.sha256"
    $stagingRoot = Join-Path $temporaryRoot "source"
    New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/ffp-crawler-agent.tar.gz" -OutFile $archivePath
        Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/ffp-crawler-agent.tar.gz.sha256" -OutFile $checksumPath
        $expectedHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
        $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($expectedHash -notmatch "^[a-f0-9]{64}$" -or $actualHash -ne $expectedHash) {
            throw "Agent package checksum verification failed."
        }

        $extractScript = @'
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1]).resolve()
destination = pathlib.Path(sys.argv[2]).resolve()
with tarfile.open(archive, "r:gz") as package:
    for member in package.getmembers():
        if member.issym() or member.islnk():
            raise RuntimeError("Agent package may not contain links")
        target = (destination / member.name).resolve()
        try:
            target.relative_to(destination)
        except ValueError as error:
            raise RuntimeError("Agent package contains an unsafe path") from error
    package.extractall(destination)
'@
        $extractScriptPath = Join-Path $temporaryRoot "extract-agent-package.py"
        Set-Content -LiteralPath $extractScriptPath -Value $extractScript -Encoding UTF8
        & $PythonCmd $extractScriptPath $archivePath $stagingRoot
        $requiredEntrypoint = Join-Path $stagingRoot "scripts\amazon-crawler-agent.py"
        $requiredRequirements = Join-Path $stagingRoot "src\modules\amazon-crawler\engine\requirements.txt"
        if (-not (Test-Path -LiteralPath $requiredEntrypoint) -or -not (Test-Path -LiteralPath $requiredRequirements)) {
            throw "Downloaded Agent package is incomplete."
        }
        Copy-Item -Path (Join-Path $stagingRoot "*") -Destination $AgentRoot -Recurse -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryRoot) {
            Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
        }
    }
} else {
    Write-Host "[2/6] Dang chay trong source tree; su dung ma Agent hien co." -ForegroundColor Gray
}

$VenvDirectory = Join-Path $AgentRoot ".venv"
$VenvPython = Join-Path $VenvDirectory "Scripts\python.exe"
Write-Host "[3/6] Thiet lap virtual environment..." -ForegroundColor Green
if (-not (Test-Path -LiteralPath $VenvPython)) {
    & $PythonCmd -m venv $VenvDirectory
}

Write-Host "[4/6] Cai dat thu vien Agent..." -ForegroundColor Green
& $VenvPython -m pip install --disable-pip-version-check --upgrade pip | Out-Null
$requirementsPath = Join-Path $AgentRoot "src\modules\amazon-crawler\engine\requirements.txt"
& $VenvPython -m pip install -r $requirementsPath

Write-Host "[5/6] Cai dat Playwright Chromium..." -ForegroundColor Green
& $VenvPython -m playwright install chromium

Write-Host "[6/6] Tao cau hinh va launcher..." -ForegroundColor Green
$configDirectory = Join-Path $AgentRoot "config"
$configFile = Join-Path $configDirectory "amazon-crawler-agent.json"
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
if (-not (Test-Path -LiteralPath $configFile)) {
    @{
        serverUrl = $ServerUrl
        displayName = $DisplayName
        dataDirectory = ".runtime/agent-data"
        heartbeatIntervalSeconds = 10
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configFile -Encoding UTF8
} else {
    Write-Host "  Giu nguyen cau hinh san co: $configFile" -ForegroundColor Gray
}

$launcher = @'
@echo off
title FFP Crawler Agent
cd /d "%~dp0"
".venv\Scripts\python.exe" scripts\amazon-crawler-agent.py --project-root .
pause
'@
Set-Content -LiteralPath (Join-Path $AgentRoot "chay-agent.bat") -Value $launcher -Encoding ASCII

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " CAI DAT HOAN TAT" -ForegroundColor Green
Write-Host " Thu muc: $AgentRoot" -ForegroundColor Cyan
Write-Host " Chay lai bang: $AgentRoot\chay-agent.bat" -ForegroundColor Yellow
Write-Host " Dang nhap Pinterest: $AgentRoot\dang-nhap-pinterest.bat" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green

if (-not $NoStart) {
    Set-Location $AgentRoot
    & $VenvPython (Join-Path $AgentRoot "scripts\amazon-crawler-agent.py") --project-root $AgentRoot
}
