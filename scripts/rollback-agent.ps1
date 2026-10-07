param(
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$CommandId,
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [Parameter(Mandatory = $true)][string]$ManifestSha256,
    [Parameter(Mandatory = $true)][int]$AgentProcessId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($CommandId -notmatch '^[A-Za-z0-9_-]{1,64}$' -or $ManifestSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Rollback command or manifest identity is invalid.'
}
$installRoot = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$expectedInstall = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'FFP Amazon Crawler')).TrimEnd('\')
if ($installRoot -ine $expectedInstall) { throw 'Rollback install path is not the standard FFP Agent directory.' }
$configFullPath = [IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $configFullPath -PathType Leaf)) { throw 'Persistent Agent configuration is missing.' }
$config = Get-Content -LiteralPath $configFullPath -Raw | ConvertFrom-Json -ErrorAction Stop

function Get-AgentServerScope([Uri]$Uri) {
    $canonicalOrigin = $Uri.Scheme.ToLowerInvariant() + '://' + $Uri.IdnHost.ToLowerInvariant()
    $safeHost = $Uri.IdnHost.ToLowerInvariant() -replace '[^a-z0-9.-]+', '-'
    if (-not $Uri.IsDefaultPort) {
        $canonicalOrigin += ':' + $Uri.Port
        $safeHost += '-' + $Uri.Port
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $digest = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonicalOrigin))) -replace '-', '').ToLowerInvariant().Substring(0, 12)
    } finally {
        $sha.Dispose()
    }
    return $safeHost.Trim('-', '.') + '-' + $digest
}

if (-not $config.serverUrl) { throw 'Persistent Agent configuration has no server URL.' }
$serverUri = [Uri][string]$config.serverUrl
$defaultDataRoot = Join-Path (Join-Path (Join-Path $env:ProgramData 'FFP Amazon Crawler') 'servers') (Get-AgentServerScope $serverUri)
$dataRootValue = if ($config.dataDirectory) { [string]$config.dataDirectory } else { $defaultDataRoot }
if (-not [IO.Path]::IsPathRooted($dataRootValue)) { $dataRootValue = Join-Path (Split-Path -Parent $configFullPath) $dataRootValue }
$dataRoot = [IO.Path]::GetFullPath($dataRootValue).TrimEnd('\')
$backupRoot = [IO.Path]::GetFullPath($BackupDirectory).TrimEnd('\')
$expectedBackupRoot = [IO.Path]::GetFullPath((Join-Path (Join-Path $dataRoot 'agent-update-backups') $CommandId)).TrimEnd('\')
if ($backupRoot -ine $expectedBackupRoot) { throw 'Rollback backup directory escaped its command-scoped data location.' }
$manifestPath = Join-Path $backupRoot 'install-manifest.json'
$installBackup = Join-Path $backupRoot 'install'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $installBackup -PathType Container)) {
    throw 'Verified prior Agent files are missing.'
}
$manifestFile = Get-Item -LiteralPath $manifestPath -Force
$backupRootItem = Get-Item -LiteralPath $backupRoot -Force
$installBackupItem = Get-Item -LiteralPath $installBackup -Force
if (($manifestFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    ($backupRootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    ($installBackupItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Rollback snapshot contains a reparse-point root.'
}
if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ManifestSha256) {
    throw 'Prior Agent file manifest checksum mismatch.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
if ($manifest.schemaVersion -ne 1 -or -not ($manifest.files -is [array]) -or $manifest.files.Count -lt 1) {
    throw 'Prior Agent file manifest is malformed.'
}
$expectedFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($entry in $manifest.files) {
    $relative = [string]$entry.path
    if (-not $relative -or [IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)') {
        throw 'Prior Agent manifest contains an unsafe path.'
    }
    $filePath = [IO.Path]::GetFullPath((Join-Path $installBackup $relative))
    if (-not $filePath.StartsWith($installBackup + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw 'Prior Agent backup file is missing or outside its backup root.' }
    if (-not $expectedFiles.Add($relative.Replace('/', '\'))) { throw 'Prior Agent manifest contains a duplicate path.' }
    $file = Get-Item -LiteralPath $filePath -Force
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $file.Length -ne [long]$entry.size -or
        (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$entry.sha256) {
        throw 'Prior Agent backup file failed size/hash verification.'
    }
}
$actualFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($item in Get-ChildItem -LiteralPath $installBackup -Force -Recurse) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Prior Agent backup contains a reparse point.'
    }
    if (-not $item.PSIsContainer) {
        $relative = $item.FullName.Substring($installBackup.Length + 1)
        [void]$actualFiles.Add($relative)
    }
}
if ($actualFiles.Count -ne $expectedFiles.Count) { throw 'Prior Agent backup contains files outside the verified manifest.' }
foreach ($relative in $actualFiles) {
    if (-not $expectedFiles.Contains($relative)) { throw 'Prior Agent backup contains files outside the verified manifest.' }
}

if ($AgentProcessId -gt 0) {
    try { Wait-Process -Id $AgentProcessId -Timeout 120 -ErrorAction Stop }
    catch { throw 'Agent did not stop cleanly; prior files were not restored.' }
}
$stage = Join-Path (Split-Path -Parent $installRoot) ('.FFP-Agent-Restore-' + $CommandId)
$failedInstall = Join-Path $backupRoot 'failed-install'
if (Test-Path -LiteralPath $stage) { throw 'Rollback staging directory already exists.' }
if (Test-Path -LiteralPath $failedInstall) { throw 'Failed Agent installation snapshot already exists.' }
try {
    Copy-Item -LiteralPath $installBackup -Destination $stage -Recurse
    Move-Item -LiteralPath $installRoot -Destination $failedInstall
    Move-Item -LiteralPath $stage -Destination $installRoot
    Start-Process -FilePath (Join-Path $installRoot 'FFPAmazonCrawlerAgent.exe') `
        -ArgumentList @('--config', $configFullPath, '--start-minimized') -WorkingDirectory $installRoot -WindowStyle Hidden
} catch {
    if ((Test-Path -LiteralPath $failedInstall) -and -not (Test-Path -LiteralPath $installRoot)) {
        Move-Item -LiteralPath $failedInstall -Destination $installRoot
    }
    throw
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
