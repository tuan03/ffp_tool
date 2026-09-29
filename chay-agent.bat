@echo off
title FFP Crawler Agent
cd /d "%~dp0"
echo ===================================================
echo     DANG KHOI CHAY FFP CRAWLER AGENT
echo ===================================================
call .venv\Scripts\activate.bat
python scripts\amazon-crawler-agent.py --project-root .
pause
