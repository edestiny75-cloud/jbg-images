@echo off
REM Double-click this to start the JBG Fiery Agent.
REM It watches the app's print queue and drops files into your Fiery hot folders.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0JBG_Fiery_Agent.ps1"
pause
