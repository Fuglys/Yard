@echo off
REM Yard Manager v2 — start script
title Yard Manager v2
cd /d "%~dp0"
echo.
echo ============================================
echo   Yard Manager v2
echo ============================================
echo.
echo Bereikbaar op:
echo.
echo   Op deze server : http://localhost:3006
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "IPv4"') do (
    set "IP=%%a"
    setlocal enabledelayedexpansion
    set "IP=!IP: =!"
    echo   Vanaf tablet  : http://!IP!:3006
    endlocal
)
echo.
echo ============================================
echo   Druk Ctrl+C om te stoppen.
echo ============================================
echo.
node server.js
echo.
echo Server gestopt.
pause
