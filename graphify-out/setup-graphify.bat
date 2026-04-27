@echo off
REM ============================================================
REM  Graphify setup script voor yard-manager (Windows)
REM ============================================================

echo.
echo === Graphify setup ===
echo.

REM 1. Check Python
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python is niet gevonden in PATH.
    echo Installeer Python 3.10+ van https://www.python.org/downloads/
    pause
    exit /b 1
)

python --version

REM 2. Install graphifyy with MCP extras
echo.
echo Installing graphifyy[mcp]...
pip install "graphifyy[mcp]"
if errorlevel 1 (
    echo [ERROR] pip install failed.
    pause
    exit /b 1
)

REM 3. Register the skill for Claude / Cowork
echo.
echo Registering graphify skill...
graphify install --platform windows

REM 4. Test the existing graph
echo.
echo === Test ===
graphify explain "BrushPopover" --graph "%~dp0graph.json"

echo.
echo === Klaar ===
echo.
echo Volgende stappen:
echo   1. Open Cowork's mcp.json (zie SETUP-GRAPHIFY.md voor exacte pad)
echo   2. Voeg de "graphify" entry toe (zie mcp-snippet.json hiernaast)
echo   3. Restart Cowork volledig
echo.
pause
