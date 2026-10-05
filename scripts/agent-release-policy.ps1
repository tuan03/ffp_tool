# Shared manifest and installer verification for the Windows crawler Agent.
# The trusted signer thumbprint must come from operator configuration, not the manifest.

function Get-AgentReleasePolicy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ManifestPath,
        [Parameter(Mandatory = $true)][string[]]$TrustedSignerThumbprints,
        [Parameter(Mandatory = $true)][string]$CurrentProtocolVersion,
        [Parameter(Mandatory = $true)][string]$CurrentServerVersion,
        [long]$MaximumArtifactBytes = 4294967296
    )

    $pins = @($TrustedSignerThumbprints | ForEach-Object { $_.Trim().ToUpperInvariant() } |
        Where-Object { $_ -match '^[A-F0-9]{40}$' } | Select-Object -Unique)
    if ($pins.Count -eq 0) { throw 'No valid out-of-band Authenticode signer pin is configured.' }

    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
    $version = [string]$manifest.version
    if ($manifest.schemaVersion -ne 1 -or $version -notmatch '^\d+\.\d+\.\d+$') {
        throw 'Release manifest schema or semantic version is invalid.'
    }
    $size = 0L
    if (-not [long]::TryParse([string]$manifest.size, [ref]$size) -or $size -le 0 -or $size -gt $MaximumArtifactBytes) {
        throw 'Release artifact size is invalid or exceeds the configured limit.'
    }
    $hash = [string]$manifest.sha256
    if ($hash -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Release artifact SHA-256 is invalid.' }
    $signer = ([string]$manifest.signerThumbprint).ToUpperInvariant()
    if ($signer -notmatch '^[A-F0-9]{40}$' -or $signer -notin $pins) {
        throw 'Release manifest signer is not present in the out-of-band trust pins.'
    }

    $expectedPath = "/tuan03/ffp_tool/releases/download/agent-v$version/FFP-Amazon-Crawler-Setup-$version.exe"
    $artifactUri = $null
    if (-not [Uri]::TryCreate([string]$manifest.url, [UriKind]::Absolute, [ref]$artifactUri) -or
        $artifactUri.Scheme -ne 'https' -or $artifactUri.Host -ne 'github.com' -or
        $artifactUri.AbsolutePath -cne $expectedPath -or $artifactUri.Query -or $artifactUri.Fragment -or $artifactUri.UserInfo) {
        throw 'Release artifact URL is not the expected immutable GitHub Release asset.'
    }

    $protocol = 0
    $currentProtocol = 0
    if (-not [int]::TryParse([string]$manifest.minimumProtocolVersion, [ref]$protocol) -or $protocol -lt 1 -or
        -not [int]::TryParse($CurrentProtocolVersion, [ref]$currentProtocol) -or $currentProtocol -lt $protocol) {
        throw 'Agent protocol is not compatible with the release.'
    }
    $minimumServer = $null
    $currentServer = $null
    if ([string]$manifest.minimumServerVersion -notmatch '^\d+\.\d+\.\d+$' -or
        $CurrentServerVersion -notmatch '^\d+\.\d+\.\d+$' -or
        -not [version]::TryParse([string]$manifest.minimumServerVersion, [ref]$minimumServer) -or
        -not [version]::TryParse($CurrentServerVersion, [ref]$currentServer) -or $currentServer -lt $minimumServer) {
        throw 'Coordinator version is not compatible with the release.'
    }

    return [pscustomobject]@{
        Version = $version
        Uri = $artifactUri
        Sha256 = $hash.ToLowerInvariant()
        Size = $size
        SignerThumbprint = $signer
        TrustedSignerThumbprints = $pins
    }
}

function Test-AgentReleaseArtifact {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Policy,
        [scriptblock]$SignatureVerifier
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Release artifact is missing.' }
    if ((Get-Item -LiteralPath $Path).Length -ne [long]$Policy.Size) { throw 'Release artifact size does not match the manifest.' }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $stream = [IO.File]::OpenRead($Path)
        try { $actualHash = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose() }
    } finally { $algorithm.Dispose() }
    if ($actualHash -cne [string]$Policy.Sha256) {
        throw 'Release artifact SHA-256 does not match the manifest.'
    }

    if ($null -ne $SignatureVerifier) {
        $signature = & $SignatureVerifier $Path $Policy.SignerThumbprint
    } else {
        $signature = Get-AuthenticodeSignature -LiteralPath $Path
        $signature = [pscustomobject]@{
            Status = [string]$signature.Status
            Thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint.ToUpperInvariant() } else { '' }
        }
    }
    if ($signature.Status -ne 'Valid' -or $signature.Thumbprint.ToUpperInvariant() -cne $Policy.SignerThumbprint -or
        $signature.Thumbprint.ToUpperInvariant() -notin $Policy.TrustedSignerThumbprints) {
        throw 'Release artifact Authenticode signature is invalid or not trusted.'
    }
    return $true
}

function Receive-AgentReleaseArtifact {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Policy,
        [Parameter(Mandatory = $true)][string]$DestinationDirectory,
        [Parameter(Mandatory = $true)][string[]]$TrustedSignerThumbprints,
        [scriptblock]$FreeBytesProbe,
        [scriptblock]$Download,
        [scriptblock]$SignatureVerifier
    )

    $destination = [IO.Path]::GetFullPath($DestinationDirectory)
    $pins = @($TrustedSignerThumbprints | ForEach-Object { $_.Trim().ToUpperInvariant() } |
        Where-Object { $_ -match '^[A-F0-9]{40}$' } | Select-Object -Unique)
    if ($pins.Count -eq 0 -or $Policy.SignerThumbprint -notin $pins) {
        throw 'Release policy signer is not present in the out-of-band trust pins.'
    }
    if ([string]$Policy.Version -notmatch '^\d+\.\d+\.\d+$' -or
        [string]$Policy.Sha256 -notmatch '^[a-f0-9]{64}$' -or
        [long]$Policy.Size -le 0 -or [long]$Policy.Size -gt 4294967296 -or
        [string]$Policy.SignerThumbprint -notmatch '^[A-F0-9]{40}$') {
        throw 'Release policy fields are malformed.'
    }
    $expectedUrl = "https://github.com/tuan03/ffp_tool/releases/download/agent-v$($Policy.Version)/FFP-Amazon-Crawler-Setup-$($Policy.Version).exe"
    if ($Policy.Uri.AbsoluteUri -cne $expectedUrl) { throw 'Release policy URL is not immutable or trusted.' }
    $null = New-Item -ItemType Directory -Force -Path $destination
    $target = Join-Path $destination "FFP-Amazon-Crawler-Setup-$($Policy.Version).exe"
    if (Test-Path -LiteralPath $target) {
        Test-AgentReleaseArtifact -Path $target -Policy $Policy -SignatureVerifier $SignatureVerifier | Out-Null
        return $target
    }
    if ($null -eq $FreeBytesProbe) {
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($destination))
        $freeBytes = [long]$drive.AvailableFreeSpace
    } else {
        $freeBytes = [long](& $FreeBytesProbe $destination)
    }
    if ($freeBytes -lt ([long]$Policy.Size + 67108864)) { throw 'Insufficient free disk space for verified Agent download.' }

    $partial = Join-Path $destination ("." + [Guid]::NewGuid().ToString('N') + '.exe.part')
    try {
        if ($null -ne $Download) {
            & $Download $Policy.Uri $partial ([long]$Policy.Size)
        } else {
            Save-AgentReleaseHttpsFile -Uri $Policy.Uri -Destination $partial -MaximumBytes ([long]$Policy.Size)
        }
        Test-AgentReleaseArtifact -Path $partial -Policy $Policy -SignatureVerifier $SignatureVerifier | Out-Null
        Move-Item -LiteralPath $partial -Destination $target
        return $target
    } finally {
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    }
}

function Save-AgentReleaseHttpsFile {
    [CmdletBinding()]
    param([Uri]$Uri, [string]$Destination, [long]$MaximumBytes)

    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(10)
    try {
        for ($redirect = 0; $redirect -le 8; $redirect++) {
            if ($Uri.Scheme -ne 'https' -or ($Uri.Host -ne 'github.com' -and $Uri.Host -notlike '*.githubusercontent.com')) {
                throw 'Release download redirect is not a trusted HTTPS GitHub host.'
            }
            $response = $client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            try {
                if ([int]$response.StatusCode -in @(301, 302, 303, 307, 308)) {
                    if ($null -eq $response.Headers.Location) { throw 'Release download redirect has no location.' }
                    $Uri = [Uri]::new($Uri, $response.Headers.Location)
                    continue
                }
                $null = $response.EnsureSuccessStatusCode()
                if ($response.Content.Headers.ContentLength -gt $MaximumBytes) { throw 'Release download exceeds manifest size.' }
                $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                $outputStream = [IO.FileStream]::new($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                try {
                    $buffer = New-Object byte[] 65536
                    [long]$received = 0
                    while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                        $received += $count
                        if ($received -gt $MaximumBytes) { throw 'Release download exceeds manifest size.' }
                        $outputStream.Write($buffer, 0, $count)
                    }
                } finally { $outputStream.Dispose(); $inputStream.Dispose() }
                return
            } finally { $response.Dispose() }
        }
        throw 'Release download exceeded the redirect limit.'
    } finally { $client.Dispose(); $handler.Dispose() }
}
