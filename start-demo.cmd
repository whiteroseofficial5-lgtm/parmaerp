@echo off
setlocal
cd /d "%~dp0"

echo ==========================================================
echo   PharmaERP demo  -  database + API + web UI, one command
echo ==========================================================
echo.

where docker >nul 2>nul
if errorlevel 1 goto nodocker

echo Starting the whole stack. The first run builds the images and can take a few minutes...
echo.
docker compose up --build -d
if errorlevel 1 goto composefailed

echo.
echo Waiting for the database, the API and the web UI (the demo data is seeded on first boot)...
set /a tries=0
:wait
set /a tries+=1
curl -sf -o nul --max-time 3 http://localhost:4000/api/health
if errorlevel 1 goto retry
curl -sf -o nul --max-time 3 http://localhost:3000
if errorlevel 1 goto retry
goto ready

:retry
if %tries% geq 80 goto timeout
timeout /t 5 /nobreak >nul
goto wait

:ready
echo.
echo   Web UI  : http://localhost:3000
echo   API     : http://localhost:4000/api/health
echo.
echo   Login   : admin@pharma.local      password: Pharma@12345
echo   Others  : qc@pharma.local, production@pharma.local, warehouse@pharma.local,
echo             purchase@pharma.local, store@pharma.local, auditor@pharma.local
echo.
echo   Stop the demo      : docker compose down
echo   Wipe the demo data : docker compose down -v
echo.
start "" http://localhost:3000
pause
exit /b 0

:nodocker
echo Docker was not found on PATH.
echo.
echo   - Install and start Docker Desktop, then run this file again.
echo   - Or, if you want to use a PostgreSQL you already installed, run:  node fix-db.mjs
pause
exit /b 1

:composefailed
echo.
echo "docker compose up" failed - is Docker Desktop running?
echo The reason is in the messages above.
pause
exit /b 1

:timeout
echo.
echo The web UI did not answer in time. Check what is happening with:
echo     docker compose logs --tail 60
pause
exit /b 1
