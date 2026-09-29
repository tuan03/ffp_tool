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
".venv\Scripts\python.exe" src\modules\pinterest-pod\server\pinterest\pinterest_browser_login.py %*
set "LOGIN_EXIT_CODE=%ERRORLEVEL%"
echo.
if "%LOGIN_EXIT_CODE%"=="0" (
    echo [OK] Dang nhap Pinterest thanh cong. Website FFP se cap nhat trong khoang 10 giay.
) else if "%LOGIN_EXIT_CODE%"=="2" (
    echo [!] Cua so trinh duyet da dong truoc khi dang nhap thanh cong.
) else if "%LOGIN_EXIT_CODE%"=="3" (
    echo [!] Het thoi gian cho dang nhap Pinterest.
) else (
    echo [!] Dang nhap Pinterest that bai. Ma loi: %LOGIN_EXIT_CODE%
)
pause
exit /b %LOGIN_EXIT_CODE%
