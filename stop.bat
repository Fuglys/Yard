@echo off
REM Yard Manager v2 — stop alles op poort 3006
title Yard Manager — Stop
echo.
echo ============================================
echo   Yard Manager v2 — server stoppen op 3006
echo ============================================
echo.
powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort 3006 -State Listen -ErrorAction SilentlyContinue; if ($conn) { foreach ($c in $conn) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if ($p) { Write-Host ('Stop PID={0} ({1})' -f $p.Id, $p.ProcessName); Stop-Process -Id $p.Id -Force } }; Start-Sleep -Seconds 1; $still = Get-NetTCPConnection -LocalPort 3006 -State Listen -ErrorAction SilentlyContinue; if ($still) { Write-Host ('Poort 3006 nog bezet door PID ' + $still.OwningProcess) -ForegroundColor Red } else { Write-Host 'Poort 3006 is nu VRIJ' -ForegroundColor Green } } else { Write-Host 'Niets actief op poort 3006' -ForegroundColor Yellow }"
echo.
pause
