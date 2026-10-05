param(
    [string]$ServerUrl,
    [string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$CommandId,
    [Parameter(Mandatory = $true)][string]$TargetVersion,
    [Parameter(Mandatory = $true)][int]$AgentProcessId,
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [Parameter(Mandatory = $true)][string]$ManifestSha256,
    [Parameter(Mandatory = $true)][string]$DatabaseBackupSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($CommandId -notmatch '^[A-Za-z0-9_-]{1,64}$' -or $TargetVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Update command identity or target version is invalid.'
}
if ($ManifestSha256 -notmatch '^[a-f0-9]{64}$' -or $DatabaseBackupSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Rollback snapshot checksum is invalid.'
}
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$configFullPath = [IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $configFullPath -PathType Leaf)) { throw 'Persistent Agent configuration is missing.' }
$config = Get-Content -LiteralPath $configFullPath -Raw | ConvertFrom-Json -ErrorAction Stop
if (-not $ServerUrl) { $ServerUrl = [string]$config.serverUrl }
$server = [Uri]$ServerUrl
if (-not $server.IsAbsoluteUri -or $server.Scheme -ne 'https' -or $server.UserInfo -or $server.Query -or $server.Fragment) {
    throw 'Agent updates require its configured public HTTPS Coordinator URL.'
}
$pins = @($config.trustedSignerThumbprints | ForEach-Object { ([string]$_).Trim().ToUpperInvariant() })
if ($pins.Count -eq 0 -or @($pins | Where-Object { $_ -notmatch '^[A-F0-9]{40}$' }).Count -gt 0) {
    throw 'No valid local trustedSignerThumbprints pin is configured; refusing update.'
}
$policyPath = Join-Path $installRoot 'scripts\agent-release-policy.ps1'
$exePath = Join-Path $installRoot 'FFPAmazonCrawlerAgent.exe'
if (-not (Test-Path -LiteralPath $policyPath -PathType Leaf) -or -not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw 'Installed Agent updater components are incomplete.'
}
. $policyPath
$healthPath = Join-Path ([IO.Path]::GetTempPath()) ('ffp-agent-health-' + [Guid]::NewGuid().ToString('N') + '.json')
$manifestPath = Join-Path ([IO.Path]::GetTempPath()) ('ffp-agent-manifest-' + [Guid]::NewGuid().ToString('N') + '.json')
$downloadDirectory = Join-Path ([IO.Path]::GetTempPath()) ('ffp-agent-update-' + [Guid]::NewGuid().ToString('N'))
$installerPath = $null
$agentStopped = $false
$installerAttempted = $false
$updatedAgent = $null
try {
    try { Wait-Process -Id $AgentProcessId -Timeout 120 -ErrorAction Stop }
    catch { throw 'Agent did not stop cleanly after DRAIN; installer was not run.' }
    $agentStopped = $true
    $healthResponse = Invoke-WebRequest -UseBasicParsing -Uri "$($server.AbsoluteUri.TrimEnd('/'))/api/v1/health" -TimeoutSec 30
    if ($healthResponse.StatusCode -ne 200) { throw 'Coordinator health check failed.' }
    [IO.File]::WriteAllText($healthPath, [string]$healthResponse.Content, [Text.UTF8Encoding]::new($false))
    $manifestUri = [Uri]'https://github.com/tuan03/ffp_tool/releases/latest/download/latest.json'
    Invoke-WebRequest -UseBasicParsing -Uri $manifestUri -OutFile $manifestPath -TimeoutSec 60
    $health = Get-Content -LiteralPath $healthPath -Raw | ConvertFrom-Json
    $policy = Get-AgentReleasePolicy -ManifestPath $manifestPath -TrustedSignerThumbprints $pins `
        -CurrentProtocolVersion ([string]$health.protocolVersion) -CurrentServerVersion ([string]$health.serverVersion)
    if ($policy.Version -cne $TargetVersion) { throw 'Signed latest release does not match the operator-approved target version.' }
    $installerPath = Receive-AgentReleaseArtifact -Policy $policy -DestinationDirectory $downloadDirectory `
        -TrustedSignerThumbprints $pins

    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installRoot`"",
        "/SERVERURL=`"$($server.AbsoluteUri.TrimEnd('/'))`"", "/DISPLAYNAME=`"$([string]$config.displayName)`"")
    $installerAttempted = $true
    $setup = Start-Process -FilePath $installerPath -ArgumentList $arguments -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Signed Agent setup failed with exit code $($setup.ExitCode)." }
    $updatedAgent = Start-Process -FilePath $exePath -ArgumentList @('--config', $configFullPath, '--start-minimized') `
        -WorkingDirectory $installRoot -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 2
        if (-not (Get-Process -Id $updatedAgent.Id -ErrorAction SilentlyContinue)) {
            throw 'Updated Agent exited during its startup stabilization window.'
        }
    }
} catch {
    $failure = $_
    if ($agentStopped) {
        if ($installerAttempted) {
            if ($updatedAgent) {
                try {
                    $databaseRestore = Start-Process -FilePath $exePath -ArgumentList @('--config', $configFullPath,
                        '--restore-update-database', '--update-command-id', $CommandId,
                        '--database-backup-path', (Join-Path $BackupDirectory 'agent.sqlite3'),
                        '--database-backup-sha256', $DatabaseBackupSha256) `
                        -WorkingDirectory $installRoot -Wait -PassThru -WindowStyle Hidden
                    if ($databaseRestore.ExitCode -ne 0) { throw 'Offline Agent database rollback failed.' }
                } catch { throw 'Could not restore the verified Agent database after failed first boot.' }
            }
            $rollbackScript = Join-Path $BackupDirectory 'install\scripts\rollback-agent.ps1'
            if (-not (Test-Path -LiteralPath $rollbackScript -PathType Leaf)) {
                $rollbackScript = Join-Path $installRoot 'scripts\rollback-agent.ps1'
            }
            if (Test-Path -LiteralPath $rollbackScript -PathType Leaf) {
                try {
                    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive',
                        '-ExecutionPolicy', 'Bypass', '-File', $rollbackScript, '-InstallDirectory', $installRoot,
                        '-ConfigPath', $configFullPath, '-CommandId', $CommandId, '-BackupDirectory', $BackupDirectory,
                        '-ManifestSha256', $ManifestSha256, '-AgentProcessId', '0') -Wait -PassThru | Out-Null
                } catch { }
            }
        } else {
            Start-Process -FilePath $exePath -ArgumentList @('--config', $configFullPath, '--start-minimized') `
                -WorkingDirectory $installRoot -WindowStyle Hidden
        }
    }
    throw $failure
} finally {
    foreach ($path in @($healthPath, $manifestPath)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    if ($installerPath -and (Test-Path -LiteralPath $installerPath)) { Remove-Item -LiteralPath $installerPath -Force }
    if (Test-Path -LiteralPath $downloadDirectory) { Remove-Item -LiteralPath $downloadDirectory -Recurse -Force }
}
