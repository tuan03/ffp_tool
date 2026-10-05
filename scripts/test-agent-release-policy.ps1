$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-release-policy.ps1')

function Assert-Throws([scriptblock]$Action, [string]$Expected) {
    try { & $Action; throw "Expected failure matching '$Expected'." }
    catch {
        if ($_.Exception.Message -notmatch $Expected) { throw }
    }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('ffp-agent-release-policy-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
try {
    $bytes = [Text.Encoding]::UTF8.GetBytes('fixture signed installer bytes')
    $sha = [Security.Cryptography.SHA256]::Create()
    $artifactHash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    $sha.Dispose()
    $pin = 'A' * 40
    $manifest = [ordered]@{
        schemaVersion = 1
        version = '5.2.2'
        url = 'https://github.com/tuan03/ffp_tool/releases/download/agent-v5.2.2/FFP-Amazon-Crawler-Setup-5.2.2.exe'
        sha256 = $artifactHash
        size = $bytes.Length
        signerThumbprint = $pin
        minimumProtocolVersion = '1'
        minimumServerVersion = '5.2.2'
    }
    $manifestPath = Join-Path $root 'latest.json'
    $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
    $policy = Get-AgentReleasePolicy -ManifestPath $manifestPath -TrustedSignerThumbprints @($pin) `
        -CurrentProtocolVersion '1' -CurrentServerVersion '5.2.2'
    if ($policy.Version -ne '5.2.2' -or $policy.Sha256 -ne $artifactHash) { throw 'Valid release manifest did not parse.' }
    Assert-Throws {
        Get-AgentReleasePolicy -ManifestPath $manifestPath -TrustedSignerThumbprints @($pin) `
            -CurrentProtocolVersion '0' -CurrentServerVersion '5.2.2'
    } 'Agent protocol'
    Assert-Throws {
        Get-AgentReleasePolicy -ManifestPath $manifestPath -TrustedSignerThumbprints @($pin) `
            -CurrentProtocolVersion '1' -CurrentServerVersion '5.2.1'
    } 'Coordinator version'

    $fixtureSignature = { param($path, $expectedPin) [pscustomobject]@{ Status = 'Valid'; Thumbprint = $expectedPin } }
    $downloaded = Join-Path $root 'verified'
    $written = Receive-AgentReleaseArtifact -Policy $policy -DestinationDirectory $downloaded -TrustedSignerThumbprints @($pin) `
        -FreeBytesProbe { param($path) 1073741824L } `
        -Download { param($uri, $path, $maximum) [IO.File]::WriteAllBytes($path, $bytes) } `
        -SignatureVerifier $fixtureSignature
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($written)) -ne [Convert]::ToBase64String($bytes)) {
        throw 'Verified artifact contents changed.'
    }
    if (@(Get-ChildItem -LiteralPath $downloaded -Filter '*.part').Count -ne 0) { throw 'Partial download was not cleaned.' }

    $existingBytes = [IO.File]::ReadAllBytes($written)
    $preserved = Receive-AgentReleaseArtifact -Policy $policy -DestinationDirectory $downloaded -TrustedSignerThumbprints @($pin) `
        -FreeBytesProbe { throw 'Existing verified artifact should not need free-space check.' } `
        -Download { throw 'Existing verified artifact should not download again.' } -SignatureVerifier $fixtureSignature
    if ($preserved -ne $written -or [Convert]::ToBase64String($existingBytes) -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($written))) {
        throw 'Existing verified artifact was not preserved.'
    }
    Assert-Throws {
        Test-AgentReleaseArtifact -Path $written -Policy $policy
    } 'Authenticode'

    $oldArtifact = Join-Path $downloaded 'FFP-Amazon-Crawler-Setup-5.2.1.exe'
    [IO.File]::WriteAllBytes($oldArtifact, $bytes)
    $oldArtifactBefore = [Convert]::ToBase64String([IO.File]::ReadAllBytes($oldArtifact))

    $badHashManifest = [ordered]@{}
    foreach ($key in $manifest.Keys) { $badHashManifest[$key] = $manifest[$key] }
    $badHashManifest.sha256 = '0' * 64
    $badHashManifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
    $badHashPolicy = Get-AgentReleasePolicy -ManifestPath $manifestPath -TrustedSignerThumbprints @($pin) `
        -CurrentProtocolVersion '1' -CurrentServerVersion '5.2.2'
    $badHashDirectory = Join-Path $root 'bad-hash'
    Assert-Throws {
        Receive-AgentReleaseArtifact -Policy $badHashPolicy -DestinationDirectory $badHashDirectory -TrustedSignerThumbprints @($pin) `
            -FreeBytesProbe { param($path) 1073741824L } `
            -Download { param($uri, $path, $maximum) [IO.File]::WriteAllBytes($path, $bytes) } `
            -SignatureVerifier $fixtureSignature
    } 'SHA-256'
    $badHashFiles = @(Get-ChildItem -LiteralPath $badHashDirectory -Force -ErrorAction SilentlyContinue)
    if ((Test-Path -LiteralPath (Join-Path $badHashDirectory 'FFP-Amazon-Crawler-Setup-5.2.2.exe')) -or $badHashFiles.Count -ne 0) {
        throw 'Invalid artifact was installed or partial data was retained.'
    }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($oldArtifact)) -ne $oldArtifactBefore) {
        throw 'Failed update altered the prior verified artifact.'
    }

    $wrongSizeManifest = [ordered]@{}
    foreach ($key in $manifest.Keys) { $wrongSizeManifest[$key] = $manifest[$key] }
    $wrongSizeManifest.size = $bytes.Length + 1
    $wrongSizeManifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
    $wrongSizePolicy = Get-AgentReleasePolicy -ManifestPath $manifestPath -TrustedSignerThumbprints @($pin) `
        -CurrentProtocolVersion '1' -CurrentServerVersion '5.2.2'
    $wrongSizeDirectory = Join-Path $root 'wrong-size'
    Assert-Throws {
        Receive-AgentReleaseArtifact -Policy $wrongSizePolicy -DestinationDirectory $wrongSizeDirectory -TrustedSignerThumbprints @($pin) `
            -FreeBytesProbe { param($path) 1073741824L } `
            -Download { param($uri, $path, $maximum) [IO.File]::WriteAllBytes($path, $bytes) } `
            -SignatureVerifier $fixtureSignature
    } 'size does not match'
    if (@(Get-ChildItem -LiteralPath $wrongSizeDirectory -Force).Count -ne 0) { throw 'Wrong-size artifact was retained.' }

    $diskDirectory = Join-Path $root 'disk-full'
    $downloadCalled = $false
    Assert-Throws {
        Receive-AgentReleaseArtifact -Policy $policy -DestinationDirectory $diskDirectory -TrustedSignerThumbprints @($pin) `
            -FreeBytesProbe { param($path) 0L } `
            -Download { $script:downloadCalled = $true } -SignatureVerifier $fixtureSignature
    } 'Insufficient free disk space'
    if ($downloadCalled) { throw 'Downloader ran after the low-disk preflight failed.' }

    $partialDirectory = Join-Path $root 'partial'
    Assert-Throws {
        Receive-AgentReleaseArtifact -Policy $policy -DestinationDirectory $partialDirectory -TrustedSignerThumbprints @($pin) `
            -FreeBytesProbe { param($path) 1073741824L } `
            -Download { param($uri, $path, $maximum) [IO.File]::WriteAllBytes($path, [byte[]]@(1, 2)); throw 'network interrupted' } `
            -SignatureVerifier $fixtureSignature
    } 'network interrupted'
    if (@(Get-ChildItem -LiteralPath $partialDirectory -Force).Count -ne 0) { throw 'Interrupted partial download was not removed.' }

    $badSignatureDirectory = Join-Path $root 'bad-signature'
    Assert-Throws {
        Receive-AgentReleaseArtifact -Policy $policy -DestinationDirectory $badSignatureDirectory -TrustedSignerThumbprints @($pin) `
            -FreeBytesProbe { param($path) 1073741824L } `
            -Download { param($uri, $path, $maximum) [IO.File]::WriteAllBytes($path, $bytes) } `
            -SignatureVerifier { param($path, $expectedPin) [pscustomobject]@{ Status = 'NotSigned'; Thumbprint = '' } }
    } 'Authenticode'
    if (@(Get-ChildItem -LiteralPath $badSignatureDirectory -Force).Count -ne 0) { throw 'Unsigned artifact was not rejected cleanly.' }

    $unsafeManifest = [ordered]@{}
    foreach ($key in $manifest.Keys) { $unsafeManifest[$key] = $manifest[$key] }
    $unsafeManifest.url = 'https://example.com/agent.exe'
    $unsafeManifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
    Assert-Throws {
        Get-AgentReleasePolicy -ManifestPath $manifestPath -TrustedSignerThumbprints @($pin) `
            -CurrentProtocolVersion '1' -CurrentServerVersion '5.2.2'
    } 'immutable GitHub Release asset'
    Write-Host 'PASS: release manifest, compatibility, signature/hash/size, low disk and partial download gates.'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
