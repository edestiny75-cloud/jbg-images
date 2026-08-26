@echo off
REM Double-click this to run the Fiery job-attribute dump tool.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Fiery_Dump_Job.ps1"
pause
