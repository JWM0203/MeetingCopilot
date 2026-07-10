@echo off
cd /d "%~dp0"
if not exist out\main\index.js (
  echo Building...
  call npm run build
)
start "" "%~dp0node_modules\electron\dist\electron.exe" .
