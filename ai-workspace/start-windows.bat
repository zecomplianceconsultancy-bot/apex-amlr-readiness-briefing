@echo off
title AI Workspace
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is nog niet geinstalleerd.
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo Node.js wordt nu geinstalleerd...
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    echo.
    echo Klaar. Sluit dit venster en dubbelklik opnieuw op start-windows.bat
  ) else (
    echo Installeer Node.js LTS via https://nodejs.org en dubbelklik daarna opnieuw op start-windows.bat
    start "" https://nodejs.org
  )
  pause
  exit /b 1
)
node scripts\launcher.mjs %*
if errorlevel 1 pause
