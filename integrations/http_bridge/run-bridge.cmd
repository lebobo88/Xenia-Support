@echo off
REM ===================================================================
REM  Xenia voice bridge - local test runner (Windows)
REM
REM  Double-click this file. Sets up a venv, generates secrets on first
REM  run only, and starts the bridge on http://127.0.0.1:8137
REM
REM  Leave this window open. Ctrl+C stops the bridge.
REM
REM  NOTE: secret generation lives in gen_secrets.py, NOT inline here.
REM  A batch file consumes '%' before Python sees it, which silently
REM  produced an empty .env.local in the first version of this script.
REM ===================================================================
setlocal enabledelayedexpansion

set "BRIDGE_DIR=%~dp0"
set "XENIA_ROOT=C:\AiAppDeployments\Xenia"

cd /d "%BRIDGE_DIR%"

where python >nul 2>&1
if errorlevel 1 (
  echo [X] Python is not on PATH. Install Python 3.10+ and re-run.
  pause & exit /b 1
)

if not exist "%XENIA_ROOT%\hearth\tasks" mkdir "%XENIA_ROOT%\hearth\tasks"

if not exist "venv\Scripts\python.exe" (
  echo [1/4] Creating virtual environment...
  python -m venv venv || (echo [X] venv creation failed & pause & exit /b 1)
)

echo [2/4] Installing dependencies...
venv\Scripts\python.exe -m pip install --quiet --upgrade pip
venv\Scripts\python.exe -m pip install --quiet -r requirements.txt || (
  echo [X] pip install failed & pause & exit /b 1
)

echo [3/4] Checking secrets...
venv\Scripts\python.exe gen_secrets.py
if errorlevel 1 (
  echo [X] Secret generation failed. Not starting.
  pause & exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in ("%BRIDGE_DIR%.env.local") do set "%%A=%%B"

if "!XENIA_BRIDGE_TOKEN!"=="" (
  echo [X] XENIA_BRIDGE_TOKEN is empty after loading .env.local.
  echo     Delete .env.local and re-run this script.
  pause & exit /b 1
)

set "HYDRA_XENIA_ROOT=%XENIA_ROOT%"
set "XENIA_SCHEMA_VERIFIED=1"
set "XENIA_TICKET_ID_WIDTH=6"

echo [4/4] Starting bridge.
echo.
echo ===================================================================
echo  Bridge on http://127.0.0.1:8137   Health: /healthz
echo  Ticket store: %XENIA_ROOT%\hearth\tasks
echo.
echo  To read the bearer token for the ElevenLabs secret field:
echo     type "%BRIDGE_DIR%.env.local"
echo.
echo  Leave this window open. Then run start-tunnel.cmd.
echo ===================================================================
echo.

venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8137 --workers 1
pause
