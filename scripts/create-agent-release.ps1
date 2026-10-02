param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string[]]$TrustedSignerThumbprints,
    [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '../installer-output' }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version must be a stable semantic version.' }
$pins = @($TrustedSignerThumbprints | ForEach-Object { $_.Trim().ToUpperInvariant() })
if ($pins.Count -eq 0 -or @($pins | Where-Object { $_ -notmatch '^[A-F0-9]{40}$' }).Count -gt 0) {
    throw 'Configure trusted code-signing certificate thumbprints before publishing.'
}
$filename = "FFP-Amazon-Crawler-Setup-$Version.exe"
$installer = Join-Path $OutputDirectory $filename
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -notin $pins) {
    throw 'Refusing to publish: installer must have a valid, allowlisted Authenticode signature.'
}
$module = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../src/modules/amazon-crawler/engine/distributed/__init__.py') -Raw
$protocolMatch = [regex]::Match($module, '(?m)^PROTOCOL_VERSION = "(\d+)"$')
$versionMatch = [regex]::Match($module, '(?m)^AGENT_VERSION = "(\d+\.\d+\.\d+)"$')
if (-not $protocolMatch.Success -or $versionMatch.Groups[1].Value -ne $Version) { throw 'Version/protocol do not match the agent source.' }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    schemaVersion = 1
    version = $Version
    url = "https://github.com/tuan03/ffp_tool/releases/download/agent-v$Version/$filename"
    sha256 = $hash
    size = (Get-Item -LiteralPath $installer).Length
    signerThumbprint = $signature.SignerCertificate.Thumbprint.ToUpperInvariant()
    minimumProtocolVersion = $protocolMatch.Groups[1].Value
    minimumServerVersion = $Version
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'latest.json') -Encoding UTF8
"$hash  $filename" | Set-Content -LiteralPath "$installer.sha256" -Encoding ascii
