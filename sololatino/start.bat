@echo off
title SoloLatino Stremio Addon
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado. Descargalo de https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Instalando dependencias (solo la primera vez)...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install fallo.
        pause
        exit /b 1
    )
)

echo.
echo  SoloLatino Stremio Addon en http://127.0.0.1:3000/manifest.json
echo  Pegalo en Stremio: Addons -^> Add addon. Cierra esta ventana para detener.
echo.
call node index.js
pause
