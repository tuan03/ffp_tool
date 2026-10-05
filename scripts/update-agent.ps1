# Deliberately disabled until the signed DRAIN/update/journal/rollback flow is implemented.
# Development source updates must use install-agent-source.ps1 explicitly on a separate install.
param(
    [string]$ServerUrl,
    [string]$InstallDirectory,
    [int]$AgentProcessId = 0
)

$ErrorActionPreference = 'Stop'
throw 'Automatic Agent updates are disabled until DRAIN, signed artifact verification, and rollback acceptance are available. No installed files were changed.'
