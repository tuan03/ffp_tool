@echo off
setlocal
cd /d "%~dp0"
npx tsx testing\module-seo-content\run-e2e-smoke.ts %*
exit /b %ERRORLEVEL%
