@echo off
REM Yard Manager v2 — Firewall regel toevoegen voor poort 3006
REM Vraagt automatisch admin rechten (UAC)

NET SESSION >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Admin rechten nodig om firewall regel toe te voegen...
    echo Klik "Ja" in de UAC popup.
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

title Yard Manager — Firewall configureren
echo.
echo ============================================
echo   Firewall regel: Yard Manager poort 3006
echo ============================================
echo.

REM Verwijder eventuele oude regel met dezelfde naam (idempotent)
netsh advfirewall firewall delete rule name="Yard Manager 3006" >nul 2>&1

REM Voeg nieuwe inbound TCP regel toe voor alle profielen
netsh advfirewall firewall add rule name="Yard Manager 3006" dir=in action=allow protocol=TCP localport=3006 profile=any
if %errorlevel% EQU 0 (
    echo.
    echo ✓ Firewall regel toegevoegd. Tablets kunnen nu verbinding maken.
) else (
    echo.
    echo ✗ Mislukt — firewall regel kon niet worden toegevoegd.
)
echo.
pause
