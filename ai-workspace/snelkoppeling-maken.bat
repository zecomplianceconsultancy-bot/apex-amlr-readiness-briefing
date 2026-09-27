@echo off
title AI Workspace - snelkoppeling maken
cd /d "%~dp0"
rem Optioneel: sleep je eigen map "Apex tools" op dit bestand om het icoon daar te zetten.
node scripts\shortcut.mjs %*
pause
