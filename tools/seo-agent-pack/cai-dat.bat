@echo off
chcp 65001 >nul
title Cài đặt FFP SEO Worker cho Codex

echo ============================================================
echo          CÀI ĐẶT FFP SEO WORKER CHO CODEX (TỰ ĐỘNG)
echo ============================================================
echo.

REM 1. Kiem tra Python 3.11+
set "PYTHON_EXE="
where python >nul 2>nul
if %errorlevel% equ 0 (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYTHON_EXE=python"
)

if "%PYTHON_EXE%"=="" (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
        if not errorlevel 1 set "PYTHON_EXE=py -3"
    )
)

if "%PYTHON_EXE%"=="" (
    echo [LỖI] Máy tính chưa có Python 3.11 trở lên!
    echo Vui lòng tải và cài đặt Python từ: https://www.python.org/downloads/
    echo LƯU Ý QUAN TRỌNG: Khi cài đặt, hãy tích chọn vào ô:
    echo   [x] "Add python.exe to PATH"
    echo.
    pause
    exit /b 1
)

REM 2. Khoi tao moi truong ao .venv
set "VENV_DIR=%~dp0.venv"
set "VENV_PYTHON=%VENV_DIR%\Scripts\python.exe"

if not exist "%VENV_PYTHON%" (
    echo [*] Đang khởi tạo môi trường Python .venv...
    %PYTHON_EXE% -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [LỖI] Không thể tạo môi trường ảo .venv.
        pause
        exit /b 1
    )
)

REM 3. Cai dat thu vien can thiet
echo [*] Đang kiểm tra và cài đặt thư viện phụ thuộc...
"%VENV_PYTHON%" -m pip install -q -r "%~dp0requirements.txt"
if errorlevel 1 (
    echo [LỖI] Cài đặt thư viện thất bại. Vui lòng kiểm tra kết nối mạng.
    pause
    exit /b 1
)

REM 4. Dang nhap va luu Token vao Windows Credential Manager
echo.
echo ============================================================
echo BƯỚC 1: ĐĂNG NHẬP TOKEN CỦA BẠN
echo.
echo Hãy dán FFP Token bạn vừa copy từ trang web.
echo.
echo CHÚ Ý BẢO MẬT:
echo Khi bạn dán token (Ctrl+V hoặc chuột phải), màn hình sẽ
echo KHÔNG HIỆN KÝ TỰ (mục đích chống nhìn trộm).
echo Cứ dán xong rồi bấm phím ENTER là được!
echo ============================================================
echo.

"%VENV_PYTHON%" "%~dp0ffp_worker.py" login --endpoint https://ffp.b6-team.site/mcp/seo-worker
if errorlevel 1 (
    echo.
    echo [LỖI] Đăng nhập thất bại.
    echo Vui lòng kiểm tra lại token: tạo mới trên web và thử lại.
    echo.
    pause
    exit /b 1
)

REM 5. Cau hinh vao Codex Workspace
echo.
echo ============================================================
echo BƯỚC 2: CẤU HÌNH VÀO CODEX WORKSPACE
echo ============================================================
echo.
set "DEFAULT_WS=%CD%"
echo Nhập đường dẫn thư mục Workspace bạn mở trong Codex:
echo - Kéo thả thư mục từ File Explorer vào đây rồi bấm Enter
echo - Hoặc bấm Enter ngay để dùng thư mục hiện tại: %DEFAULT_WS%
echo.
set "TARGET_WS="
set /p "TARGET_WS=> "
if "%TARGET_WS%"=="" set "TARGET_WS=%DEFAULT_WS%"

REM Bo dau ngoac kep neu keo tha thu muc vao CMD
set "TARGET_WS=%TARGET_WS:"=%"

if not exist "%TARGET_WS%" (
    echo [*] Thư mục chưa tồn tại, đang tạo: %TARGET_WS%
    mkdir "%TARGET_WS%" 2>nul
)

"%VENV_PYTHON%" "%~dp0ffp_worker.py" setup --endpoint https://ffp.b6-team.site/mcp/seo-worker --workspace "%TARGET_WS%" >nul 2>nul
if errorlevel 1 (
    if exist "%TARGET_WS%\.agents\skills\ffp-seo\SKILL.md" (
        echo [OK] Codex Workspace đã có cấu hình FFP từ trước. Token mới đã được cập nhật!
    ) else (
        echo [LƯU Ý] Không thể thêm cấu hình tự động. Bạn có thể kiểm tra lại quyền ghi thư mục.
    )
) else (
    echo [OK] Đã thêm cấu hình MCP và Skill vào Workspace: %TARGET_WS%
)

echo.
echo ============================================================
echo [HOÀN TẤT] CÀI ĐẶT THÀNH CÔNG!
echo.
echo Các bước tiếp theo:
echo 1. Tắt hẳn ứng dụng Codex rồi mở lại.
echo 2. Mở thư mục Workspace trong Codex:
echo    %TARGET_WS%
echo 3. Nhập câu lệnh: Use $ffp-seo để giao việc.
echo ============================================================
echo.
pause
