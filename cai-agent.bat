@echo off
setlocal
title Cai Dat FFP Crawler Agent
set "SERVER_URL=%~1"
if "%SERVER_URL%"=="" set "SERVER_URL=https://ffp.b6-team.site"
echo ==========================================================
echo        FFP CRAWLER AGENT - CAI DAT TU XA
echo ==========================================================
echo Server: %SERVER_URL%
echo.
if exist "%~dp0scripts\install-agent.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-agent.ps1" -ServerUrl "%SERVER_URL%"
) else (
  set "FFP_SERVER_URL=%SERVER_URL%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "^& ([scriptblock]::Create((Invoke-RestMethod ($env:FFP_SERVER_URL + '/install-agent.ps1'))))"
)
pause
