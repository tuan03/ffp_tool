# ==============================================================================
# FFP Tool - Database Backup Script (Windows PowerShell)
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
# Output:
#   backups\ffp_backup_YYYYMMDD_HHMMSS.sql
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $RootDir

$BackupDir = Join-Path $RootDir "backups"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = Join-Path $BackupDir "ffp_backup_$Timestamp.sql"

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
Write-Host " Starting Database Backup for FFP Tool" -ForegroundColor Yellow
Write-Host " Database: $DbName (User: $DbUser)" -ForegroundColor Gray
Write-Host " Destination: $BackupFile" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

docker compose exec -T database pg_dump -U "$DbUser" -d "$DbName" --clean --if-exists | Set-Content -Path $BackupFile -Encoding UTF8

if ((Get-Item $BackupFile).Length -gt 0) {
    $sizeKb = [math]::Round((Get-Item $BackupFile).Length / 1KB, 2)
    Write-Host "Backup successfully completed!" -ForegroundColor Green
    Write-Host "File: $BackupFile ($sizeKb KB)" -ForegroundColor Cyan
} else {
    Write-Host "Error: Backup file is empty!" -ForegroundColor Red
    Remove-Item -Path $BackupFile -Force
    exit 1
}
