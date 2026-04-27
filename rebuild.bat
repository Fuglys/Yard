@echo off
REM Yard Manager v2 — frontend rebuild + restart server
title Yard Manager — Rebuild
cd /d "%~dp0"
echo.
echo ============================================
echo   Yard Manager v2 — frontend bouwen...
echo ============================================
echo.
cd frontend
call npm run build
if errorlevel 1 (
  echo Build mislukt!
  pause
  exit /b 1
)
cd ..
echo.
echo Build OK. Vergeet niet de server te herstarten.
echo (start.bat dubbelklikken nadat je de oude hebt gestopt met Ctrl+C)
echo.
pause
