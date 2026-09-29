# ==============================================================================
# FFP Tool - Database Restore Script (Windows PowerShell)
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\restore-db.ps1 -BackupFile <path>
# Example:
#   powershell -ExecutionPolicy Bypass -File scripts\restore-db.ps1 -BackupFile backups\ffp_backup_20260929_120000.sql
# ==============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupFile)) {
    Write-Host "Error: Backup file not found: $BackupFile" -ForegroundColor Red
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $RootDir

$DbUser = "ffp_tool"
$DbName = "ffp_tool"

if (Test-Path ".env") {
    $envLines = Get-Content ".env"
    foreach ($line in $envLines) {
        if ($line -match "^POSTGRES_USER=(.*)$") { $DbUser = $matches[1].Trim('"').Trim("'") }
        if ($line -match "^POSTGRES_DB=(.*)$") { $DbName = $matches[1].Trim('"').Trim("'") }
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Starting Database Restore for FFP Tool" -ForegroundColor Yellow
Write-Host " Database: $DbName (User: $DbUser)" -ForegroundColor Gray
Write-Host " Source file: $BackupFile" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

Get-Content $BackupFile -Raw | docker compose exec -T database psql -U "$DbUser" -d "$DbName"

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Database restored successfully!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
