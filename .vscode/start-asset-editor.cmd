@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

echo [NorthCore] Pruefe Port 5173 ...

set "BLOCKED="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5173 .*LISTENING"') do (
    set "IMAGE="
    for /f "tokens=1 delims=," %%I in ('tasklist /FI "PID eq %%P" /FO CSV /NH 2^>nul') do (
        set "IMAGE=%%~I"
    )

    if /I "!IMAGE!"=="node.exe" (
        echo [NorthCore] Beende alten Node-Server auf Port 5173, PID %%P ...
        taskkill /PID %%P /F >nul 2>&1
    ) else (
        if not "!IMAGE!"=="" (
            echo [NorthCore] Port 5173 wird von !IMAGE! mit PID %%P verwendet.
            set "BLOCKED=1"
        )
    )
)

if defined BLOCKED (
    echo.
    echo [NorthCore] Start abgebrochen.
    echo Beende in VS Code zuerst "Go Live" oder eine andere Port-5173-Sitzung.
    echo Danach erneut F5 druecken.
    exit /b 1
)

echo [NorthCore] Starte Vite auf http://127.0.0.1:5173/ ...
call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
