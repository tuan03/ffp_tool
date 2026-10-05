# Windows x64 release bootstrap. Trust pins must be supplied out-of-band by the operator.
# Source-tree development installs use install-agent-source.ps1 instead.
param(
    [string]$ServerUrl = $env:FFP_SERVER_URL,
    [string]$DisplayName = $env:COMPUTERNAME,
    [string[]]$TrustedSignerThumbprints = @($env:FFP_AGENT_TRUSTED_SIGNERS -split ','),
    [string]$ManifestUrl = 'https://github.com/tuan03/ffp_tool/releases/latest/download/latest.json'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-HttpsUri([string]$Value) {
    $uri = [Uri]$Value
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        $uri.Host -match '(^localhost$|(^|\.)example\.(com|org|net)$)') {
        throw 'A real HTTPS URL without credentials, query or fragment is required.'
    }
    return $uri
}

function Save-HttpsFile([Uri]$Uri, [string]$Destination, [long]$MaximumBytes) {
    # Inspect every redirect before following it; never allow HTTPS -> HTTP.
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(10)
    try {
        for ($redirect = 0; $redirect -le 8; $redirect++) {
            if ($Uri.Scheme -ne 'https') { throw 'Download redirect must use HTTPS.' }
            $response = $client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            try {
                if ([int]$response.StatusCode -in @(301, 302, 303, 307, 308)) {
                    $Uri = New-Object Uri($Uri, $response.Headers.Location)
                    continue
                }
                $null = $response.EnsureSuccessStatusCode()
                if ($response.Content.Headers.ContentLength -gt $MaximumBytes) { throw 'Download exceeds size limit.' }
                $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                $outputStream = [IO.File]::Create($Destination)
                try {
                    $buffer = New-Object byte[] 65536
                    [long]$total = 0
                    while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                        $total += $count
                        if ($total -gt $MaximumBytes) { throw 'Download exceeds size limit.' }
                        $outputStream.Write($buffer, 0, $count)
                    }
                } finally { $outputStream.Dispose(); $inputStream.Dispose() }
                return
            } finally { $response.Dispose() }
        }
        throw 'Too many download redirects.'
    } finally { $client.Dispose(); $handler.Dispose() }
}

if (-not $ServerUrl) { throw 'Set FFP_SERVER_URL or pass -ServerUrl with your public HTTPS domain.' }
$ServerUrl = (Assert-HttpsUri $ServerUrl.Trim().TrimEnd('/')).AbsoluteUri.TrimEnd('/')
$null = Assert-HttpsUri $ManifestUrl
if ($DisplayName -match '[\x00-\x1f"]') { throw 'DisplayName contains unsupported control/quote characters.' }
$pins = @($TrustedSignerThumbprints | ForEach-Object { $_.Trim().ToUpperInvariant() })
if ($pins.Count -eq 0 -or @($pins | Where-Object { $_ -notmatch '^[A-F0-9]{40}$' }).Count -gt 0) {
    throw 'Set FFP_AGENT_TRUSTED_SIGNERS to the approved Authenticode certificate thumbprint. Do not trust a pin supplied only by a downloaded manifest.'
}
if (-not [Environment]::Is64BitOperatingSystem) { throw 'The release installer requires Windows x64.' }
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('ffp-agent-release-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temporaryRoot
$manifestPath = Join-Path $temporaryRoot 'latest.json.part'
$installerPath = $null
$reportPath = Join-Path $temporaryRoot 'identity.json'
try {
    $policyScriptPath = Join-Path $temporaryRoot 'agent-release-policy.ps1'
    $localPolicyScript = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'agent-release-policy.ps1' } else { '' }
    if ($localPolicyScript -and (Test-Path -LiteralPath $localPolicyScript -PathType Leaf)) {
        Copy-Item -LiteralPath $localPolicyScript -Destination $policyScriptPath
    } else {
        Save-HttpsFile ([Uri]"$ServerUrl/agent-release-policy.ps1") $policyScriptPath 65536
    }
    . $policyScriptPath
    Save-HttpsFile ([Uri]$ManifestUrl) $manifestPath 65536
    $healthPath = Join-Path $temporaryRoot 'health.json'
    Save-HttpsFile ([Uri]"$ServerUrl/api/v1/health") $healthPath 65536
    $health = Get-Content -LiteralPath $healthPath -Raw | ConvertFrom-Json
    $policy = Get-AgentReleasePolicy -ManifestPath $manifestPath -TrustedSignerThumbprints $pins `
        -CurrentProtocolVersion ([string]$health.protocolVersion) -CurrentServerVersion ([string]$health.serverVersion)
    $installerPath = Receive-AgentReleaseArtifact -Policy $policy -DestinationDirectory $temporaryRoot `
        -TrustedSignerThumbprints $pins
    $installDirectory = Join-Path $env:ProgramFiles 'FFP Amazon Crawler'
    $executable = Join-Path $installDirectory 'FFPAmazonCrawlerAgent.exe'
    if (Test-Path -LiteralPath $executable) {
        throw 'An installed agent already exists. Automatic upgrade is blocked until the signed rollback flow has passed acceptance; your installation was not changed.'
    }
    $configDirectory = Join-Path $env:PROGRAMDATA 'FFP Amazon Crawler'
    $configPath = Join-Path $configDirectory 'agent.json'
    $null = New-Item -ItemType Directory -Force -Path $configDirectory
    if (-not (Test-Path -LiteralPath $configPath)) {
        @{ serverUrl = $ServerUrl; displayName = $DisplayName; maxConcurrentInputs = 4; trustedSignerThumbprints = $pins } |
            ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
    }
    $setup = Start-Process -FilePath $installerPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/SERVERURL=`"$ServerUrl`"", "/DISPLAYNAME=`"$DisplayName`"", "/TRUSTEDSIGNERS=$($pins -join ',')") -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Installer failed with exit code $($setup.ExitCode). Existing data was preserved." }
    $check = Start-Process -FilePath $executable -ArgumentList @('--check-config', "--config `"$configPath`"", "--installation-report `"$reportPath`"") -WindowStyle Hidden -Wait -PassThru
    if ($check.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $reportPath)) { throw 'Packaged agent configuration check failed.' }
    $identity = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    if ($identity.serverUrl.TrimEnd('/') -ne $ServerUrl) { throw 'Existing configuration targets another server. It was preserved; review it before starting.' }
    $null = Start-Process -FilePath $executable -ArgumentList @('--start-minimized', "--config `"$configPath`"") -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    $clientsPath = Join-Path $temporaryRoot 'clients.json'
    do {
        Save-HttpsFile ([Uri]"$ServerUrl/api/v1/clients") $clientsPath 4MB
        $clients = Get-Content -LiteralPath $clientsPath -Raw | ConvertFrom-Json
        $online = @($clients | Where-Object { $_.id -eq $identity.clientId -and $_.isConnected -and $_.status -in @('online', 'busy', 'waiting_captcha') })
        if ($online.Count -gt 0) { Write-Host 'Agent installed and confirmed online.'; return }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Agent did not appear online within 90 seconds. Check the dashboard, HTTPS/WebSocket routing and firewall. Data has been preserved.'
} finally {
    # Delete only our explicit temporary files, never an install/data directory.
    foreach ($name in @('latest.json.part', 'identity.json', 'health.json', 'clients.json')) {
        $path = Join-Path $temporaryRoot $name
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    if ($installerPath -and (Test-Path -LiteralPath $installerPath)) { Remove-Item -LiteralPath $installerPath -Force }
    Remove-Item -LiteralPath $temporaryRoot
}
