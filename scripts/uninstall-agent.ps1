param(
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [int]$AgentProcessId = 0,
    [string]$ServerUrl = "",
    [string]$ClientId = "",
    [switch]$KeepData
)

$ErrorActionPreference = "Stop"
$AgentRoot = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
$manifestPath = Join-Path $AgentRoot "agent-package-manifest.json"
$configPath = Join-Path $AgentRoot "config\amazon-crawler-agent.json"
$rootPath = [IO.Path]::GetPathRoot($AgentRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$protectedRoots = @(
    $rootPath,
    [IO.Path]::GetFullPath([Environment]::GetFolderPath("UserProfile")).TrimEnd([IO.Path]::DirectorySeparatorChar),
    [IO.Path]::GetFullPath([Environment]::GetFolderPath("LocalApplicationData")).TrimEnd([IO.Path]::DirectorySeparatorChar)
)
if ($protectedRoots -contains $AgentRoot -or -not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $configPath)) {
    throw "Refusing to uninstall: InstallDirectory is not a verified FFP Crawler Agent installation."
}

if ($AgentProcessId -gt 0) {
    Wait-Process -Id $AgentProcessId -Timeout 30 -ErrorAction SilentlyContinue
}

if ($ServerUrl.Trim() -and $ClientId.Trim()) {
    $forgetUrl = "$($ServerUrl.Trim().TrimEnd('/'))/api/v1/clients/$([Uri]::EscapeDataString($ClientId.Trim()))"
    foreach ($attempt in 1..5) {
        try {
            Invoke-WebRequest -UseBasicParsing -Method Delete -Uri $forgetUrl | Out-Null
            break
        }
        catch {
            $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            if ($statusCode -eq 404) { break }
            if ($statusCode -ne 409 -or $attempt -eq 5) {
                Write-Warning "Khong the xoa dang ky Agent tren FFP; ban van co the quen may tu giao dien web."
                break
            }
            Start-Sleep -Seconds 2
        }
    }
}

$shortcutPaths = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "FFP Crawler Agent.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Startup")) "FFP Crawler Agent.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Dang nhap Pinterest FFP.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "Dang nhap Pinterest FFP.lnk")
)
foreach ($shortcutPath in $shortcutPaths) {
    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
}

if (-not $KeepData) {
    Remove-Item -LiteralPath $AgentRoot -Recurse -Force
    Write-Host "Da go FFP Crawler Agent va toan bo du lieu cuc bo." -ForegroundColor Green
    exit 0
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $relativePath = ([string]$entry.path).Replace("/", [IO.Path]::DirectorySeparatorChar)
    $targetPath = [IO.Path]::GetFullPath((Join-Path $AgentRoot $relativePath))
    $rootPrefix = $AgentRoot + [IO.Path]::DirectorySeparatorChar
    if ($targetPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
        Remove-Item -LiteralPath $targetPath -Force
    }
}
Remove-Item -LiteralPath (Join-Path $AgentRoot ".venv") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $AgentRoot "chay-agent.bat") -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue

Get-ChildItem -LiteralPath $AgentRoot -Directory -Recurse -ErrorAction SilentlyContinue |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object {
        if ((Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
Write-Host "Da go chuong trinh. Cau hinh, profile Pinterest va du lieu runtime da duoc giu lai tai $AgentRoot." -ForegroundColor Green
