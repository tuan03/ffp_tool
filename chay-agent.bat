@echo off
title FFP Crawler Agent
cd /d "%~dp0"
echo ==========================================================
echo               FFP CRAWLER AGENT DANG CHAY
echo ==========================================================
echo.
if exist ".venv\Scripts\python.exe" (
    .venv\Scripts\python.exe scripts\amazon-crawler-agent.py --project-root . %*
) else (
    echo [!] Chua tim thay moi truong .venv! Dang chay trinh cai dat...
    call cai-agent.bat
)
pause
