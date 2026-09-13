@echo off
cd /d "%~dp0"
echo Starting TioAnime Stremio Addon...
echo Install URL: http://localhost:7000/manifest.json
echo.
echo Keep this window open while using Stremio.
echo Close it to stop the addon.
echo.
node index.js
pause
