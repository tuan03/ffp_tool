@echo off
title Cai Dat FFP Crawler Agent
cd /d "%~dp0"
echo ==========================================================
echo        FFP CRAWLER AGENT - CAI DAT 1 LENH DUY NHAT
echo ==========================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-agent.ps1" %*
pause
