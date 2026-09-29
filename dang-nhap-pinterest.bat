@echo off
title Dang Nhap Pinterest - FFP Crawler Agent
cd /d "%~dp0"
echo ==========================================================
echo        DANG NHAP TAI KHOAN PINTEREST CHO CRAWLER
echo ==========================================================
echo.
if not exist ".venv\Scripts\python.exe" (
    echo [!] Chua tim thay moi truong .venv! Dang chay cai-agent.bat...
    call cai-agent.bat
)
echo [*] Dang khoi chay trinh duyet Chromium...
echo [*] Cua so dang nhap se mo ra tren man hinh.
echo [*] Hay dang nhap tai khoan Pinterest cua ban.
echo [*] Cua so se tu dong dong lai sau khi phat hien dang nhap thanh cong.
echo.
call .venv\Scripts\activate.bat
python src\modules\pinterest-pod\server\pinterest\pinterest_browser_login.py %*
pause
