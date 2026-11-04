@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

echo.
echo   Portfolio - starting server
echo.
echo   Site:    http://127.0.0.1:5173
echo   Admin:   http://127.0.0.1:5173/admin
echo   Stop:    Ctrl+C or close this window
echo.

if not defined SKIP_BROWSER start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:5173/"

node server.js
set "CODE=%errorlevel%"

echo.
if not "%CODE%"=="0" echo   Server exited with code %CODE% - see the message above.
pause
exit /b %CODE%

:nonode
echo.
echo   Node.js not found. Install it from https://nodejs.org (version 18 or newer).
echo.
pause
exit /b 1
