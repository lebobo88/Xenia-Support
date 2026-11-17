@echo off
REM ===================================================================
REM  Public tunnel to the local Xenia bridge (TEST USE ONLY)
REM
REM  This exposes 127.0.0.1:8137 to the public internet so ElevenLabs
REM  can reach it. The URL is ephemeral: it changes every run and dies
REM  when this window closes or the machine sleeps. Fine for wiring up
REM  and testing the tool; not a production endpoint for a phone line.
REM
REM  The bridge's bearer token is the only thing guarding it, which is
REM  why run-bridge.cmd generates a 48-byte one. Nothing behind this
REM  endpoint can perform a monetary or irreversible action.
REM
REM  Run run-bridge.cmd FIRST, in its own window.
REM ===================================================================
setlocal

set "TUNNEL_DIR=%~dp0"
cd /d "%TUNNEL_DIR%"

curl -s -o nul -w "" http://127.0.0.1:8137/healthz
if errorlevel 1 (
  echo [X] The bridge is not answering on port 8137.
  echo     Start run-bridge.cmd first and leave it running.
  pause & exit /b 1
)

if not exist "cloudflared.exe" (
  echo Downloading cloudflared...
  curl -L -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe || (
    echo [X] Download failed. Install cloudflared manually, or use ngrok.
    pause & exit /b 1
  )
)

echo.
echo ===================================================================
echo  Starting tunnel. Look for the line that says:
echo     https://SOMETHING.trycloudflare.com
echo  Send that URL to Claude. Do NOT send the bearer token.
echo ===================================================================
echo.

cloudflared.exe tunnel --url http://127.0.0.1:8137
pause
