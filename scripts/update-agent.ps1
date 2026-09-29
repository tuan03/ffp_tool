param(
    [Parameter(Mandatory = $true)][string]$ServerUrl,
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [int]$AgentProcessId = 0
)

$ErrorActionPreference = "Stop"
$ServerUrl = $ServerUrl.Trim().TrimEnd("/")
$serverUri = [Uri]$ServerUrl
if (-not $serverUri.IsAbsoluteUri -or $serverUri.Scheme -notin @("http", "https")) {
    throw "ServerUrl must be an absolute HTTP(S) URL."
}
$AgentRoot = [IO.Path]::GetFullPath($InstallDirectory)
$manifestPath = Join-Path $AgentRoot "agent-package-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath (Join-Path $AgentRoot "config\amazon-crawler-agent.json"))) {
    throw "InstallDirectory is not a valid FFP Crawler Agent installation."
}

Write-Host "Dang cap nhat FFP Crawler Agent tai $AgentRoot" -ForegroundColor Cyan
if ($AgentProcessId -gt 0) {
    Wait-Process -Id $AgentProcessId -Timeout 30 -ErrorAction SilentlyContinue
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("ffp-agent-update-" + [Guid]::NewGuid().ToString("N"))
$backupRoot = Join-Path $temporaryRoot "backup"
$installerPath = Join-Path $temporaryRoot "install-agent.ps1"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($entry in $manifest.files) {
        $relativePath = [string]$entry.path
        $sourcePath = Join-Path $AgentRoot $relativePath
        if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
            $destinationPath = Join-Path $backupRoot $relativePath
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationPath) | Out-Null
            Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
        }
    }
    Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $backupRoot "agent-package-manifest.json") -Force
    Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/install-agent.ps1" -OutFile $installerPath
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerPath `
        -ServerUrl $ServerUrl -InstallDirectory $AgentRoot -NoStart
    if ($LASTEXITCODE -ne 0) {
        throw "Installer exited with code $LASTEXITCODE."
    }
    Start-Process -FilePath (Join-Path $AgentRoot "chay-agent.bat") -WorkingDirectory $AgentRoot -WindowStyle Hidden
    Write-Host "Cap nhat thanh cong. Agent dang khoi dong lai." -ForegroundColor Green
}
catch {
    Write-Host "Cap nhat that bai; dang khoi phuc cac file Agent cu..." -ForegroundColor Red
    if (Test-Path -LiteralPath $backupRoot) {
        Copy-Item -Path (Join-Path $backupRoot "*") -Destination $AgentRoot -Recurse -Force
    }
    $launcherPath = Join-Path $AgentRoot "chay-agent.bat"
    if (Test-Path -LiteralPath $launcherPath) {
        Start-Process -FilePath $launcherPath -WorkingDirectory $AgentRoot -WindowStyle Hidden
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
